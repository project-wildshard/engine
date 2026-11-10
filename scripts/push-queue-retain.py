#!/usr/bin/env python3
"""Export only explicit, bounded fixture diagnostics; never follow a link."""
import hashlib
import json
import os
import re
import stat
import sys
import time
import uuid

LIMIT = 64 * 1024 * 1024
NAMESPACE_LIMIT = 256 * 1024 * 1024
ENTRIES = 4096
REQUESTS = 16
SUMMARY = 65536
NOFOLLOW = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
REGULAR = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
UUID = r"[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}"
UID = os.getuid()


def absolute_directory(path):
    if not os.path.isabs(path):
        raise ValueError("directory must be absolute")
    fd = os.open("/", NOFOLLOW)
    try:
        for part in path.split("/"):
            if not part:
                continue
            if part in (".", ".."):
                raise ValueError("unsafe directory")
            child = os.open(part, NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def owned(fd, directory=False):
    info = os.fstat(fd)
    if info.st_uid != UID or (not directory and
                             (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1)):
        raise ValueError("not an owned regular single-link file")
    if directory and not stat.S_ISDIR(info.st_mode):
        raise ValueError("not an owned directory")
    return info


def directory(parent, name):
    try:
        os.mkdir(name, 0o700, dir_fd=parent)
    except FileExistsError:
        pass
    fd = os.open(name, NOFOLLOW, dir_fd=parent)
    try:
        info = owned(fd, True)
        if info.st_mode & 0o077:
            raise ValueError("retained directory is not private")
        return fd
    except BaseException:
        os.close(fd)
        raise


def write_all(fd, data):
    offset = 0
    while offset < len(data):
        written = os.write(fd, data[offset:])
        if written < 1:
            raise ValueError("incomplete diagnostic write")
        offset += written


def read_request(parent, name):
    fd = os.open(name, REGULAR, dir_fd=parent)
    try:
        info = owned(fd)
        if info.st_size > 4096:
            raise ValueError("request exceeds 4096 bytes")
        data = os.read(fd, 4097)
        if len(data) > 4096:
            raise ValueError("request grew beyond limit")
        def pairs(values):
            result = {}
            for key, value in values:
                if key in result:
                    raise ValueError("duplicate request key")
                result[key] = value
            return result
        value = json.loads(data, object_pairs_hook=pairs)
        if not isinstance(value, dict) or set(value) != {"schema", "kind", "profile"}:
            raise ValueError("invalid request fields")
        prefixes = {"native-writer-drain": "native-writer-drain-",
                    "native-escape": "escape-control-"}
        kind = value["kind"]
        if value["schema"] != "wildshard.native-retain/1" or not isinstance(kind, str) or kind not in prefixes:
            raise ValueError("unsupported native request")
        profile = value["profile"]
        if not isinstance(profile, str) or not re.fullmatch(
                "tmp/" + prefixes[kind] + r"[A-Za-z0-9]{6}", profile):
            raise ValueError("unsafe native profile path")
        return value
    finally:
        os.close(fd)


def measure(fd, deadline, ceiling=16384):
    size, entries = 0, 0
    stack = [os.dup(fd)]
    try:
        while stack:
            current = stack.pop()
            try:
                with os.scandir(current) as names:
                    for item in names:
                        entries += 1
                        if entries > ceiling or time.monotonic() > deadline:
                            raise ValueError("retained namespace inspection limit")
                        info = os.stat(item.name, dir_fd=current, follow_symlinks=False)
                        if info.st_uid != UID:
                            raise ValueError("foreign retained namespace entry")
                        if stat.S_ISDIR(info.st_mode):
                            stack.append(os.open(item.name, NOFOLLOW, dir_fd=current))
                        elif stat.S_ISREG(info.st_mode) and info.st_nlink == 1:
                            size += info.st_size
                        else:
                            raise ValueError("unsafe retained namespace entry")
            finally:
                os.close(current)
        return size, entries
    finally:
        for current in stack:
            os.close(current)


def export(snapshot, queue, job, sha):
    if not re.fullmatch(r"\d{9,}-[a-f0-9]{8}", job) or not re.fullmatch(r"[a-f0-9]{40}", sha):
        raise ValueError("invalid checked job identity")
    deadline = time.monotonic() + 4
    source = absolute_directory(snapshot)
    descriptors = [source]
    report = {"schema": "wildshard.native-retained/1", "job": job,
              "checkedSha": sha, "requests": [], "bytes": 0, "entries": 0,
              "partial": False}
    try:
        queue_fd = absolute_directory(queue)
        descriptors.append(queue_fd)
        owned(queue_fd, True)
        try:
            tmp = os.open("tmp", NOFOLLOW, dir_fd=source)
            descriptors.append(tmp)
            requests = os.open("queue-retain-requests", NOFOLLOW, dir_fd=tmp)
            descriptors.append(requests)
        except FileNotFoundError:
            return None
        owned(source, True)
        owned(tmp, True)
        owned(requests, True)
        retained = directory(queue_fd, "retained")
        descriptors.append(retained)
        namespace_bytes, _ = measure(retained, deadline)
        target = directory(retained, job)
        descriptors.append(target)
        used_bytes, used_entries = measure(target, deadline)
        with os.scandir(target) as previous:
            remaining_requests = REQUESTS - sum(1 for entry in previous
                if re.fullmatch(UUID, entry.name) and entry.is_dir(follow_symlinks=False))
        available = min(LIMIT - used_bytes, NAMESPACE_LIMIT - namespace_bytes) - SUMMARY
        available_entries = ENTRIES - used_entries - 1
        if available < 0 or available_entries < 1:
            raise ValueError("retention namespace/job quota exceeded")
        with os.scandir(requests) as names:
            for item in names:
                if len(report["requests"]) >= REQUESTS or time.monotonic() > deadline:
                    report["partial"] = True
                    break
                row = {"request": item.name, "copiedFiles": 0, "bytes": 0,
                       "skipped": 0, "omissions": []}
                report["requests"].append(row)
                def omit(path, reason):
                    row["skipped"] += 1
                    report["partial"] = True
                    if len(row["omissions"]) < 8:
                        row["omissions"].append({"path": path[:200], "reason": reason})
                if not re.fullmatch(UUID + r"\.json", item.name):
                    omit("", "invalid request name")
                    continue
                try:
                    request = read_request(requests, item.name)
                    row.update(request)
                    if available < 0 or available_entries < 1 or remaining_requests < 1:
                        raise ValueError("retention byte/entry/request quota exceeded")
                    profile = os.open(request["profile"].split("/")[1], NOFOLLOW, dir_fd=tmp)
                    try:
                        owned(profile, True)
                        # Exclusive request directories never overwrite prior evidence.
                        os.mkdir(item.name[:-5], 0o700, dir_fd=target)
                        remaining_requests -= 1
                        available_entries -= 1
                        report["entries"] += 1
                        output = os.open(item.name[:-5], NOFOLLOW, dir_fd=target)
                    except BaseException:
                        os.close(profile)
                        raise
                    copied_hashes = []
                    stack = [(profile, output, "")]
                    try:
                        while stack:
                            parent, destination, relative = stack.pop()
                            try:
                                with os.scandir(parent) as files:
                                    for entry in files:
                                        report["entries"] += 1
                                        available_entries -= 1
                                        path = relative + entry.name
                                        if available_entries < 0 or time.monotonic() > deadline:
                                            raise ValueError("entry/time quota exceeded")
                                        info = os.stat(entry.name, dir_fd=parent, follow_symlinks=False)
                                        if len(path.encode("utf8", "surrogateescape")) > 512:
                                            omit(path, "path limit")
                                        elif info.st_uid != UID:
                                            omit(path, "foreign owner")
                                        elif stat.S_ISDIR(info.st_mode):
                                            child = os.open(entry.name, NOFOLLOW, dir_fd=parent)
                                            try:
                                                owned(child, True)
                                                os.mkdir(entry.name, 0o700, dir_fd=destination)
                                                child_out = os.open(entry.name, NOFOLLOW, dir_fd=destination)
                                            except BaseException:
                                                os.close(child)
                                                raise
                                            stack.append((child, child_out, path + "/"))
                                        elif not stat.S_ISREG(info.st_mode) or info.st_nlink != 1:
                                            omit(path, "link or special file")
                                        elif info.st_size > available:
                                            omit(path, "byte quota exceeded")
                                        else:
                                            original = os.open(entry.name, REGULAR, dir_fd=parent)
                                            created = None
                                            try:
                                                before = owned(original)
                                                if before.st_size > available:
                                                    raise ValueError("file exceeds remaining quota")
                                                created = os.open(entry.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=destination)
                                                file_hash, size = hashlib.sha256(), 0
                                                while True:
                                                    block = os.read(original, min(65536, available - size + 1))
                                                    if not block:
                                                        break
                                                    size += len(block)
                                                    if size > available or time.monotonic() > deadline:
                                                        raise ValueError("copy byte/time quota exceeded")
                                                    file_hash.update(block)
                                                    write_all(created, block)
                                                after = owned(original)
                                                if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns) or size != before.st_size:
                                                    raise ValueError("profile changed during copy")
                                                available -= size
                                                report["bytes"] += size
                                                row["bytes"] += size
                                                row["copiedFiles"] += 1
                                                copied_hashes.append((path, file_hash.digest()))
                                            except (OSError, ValueError) as error:
                                                if created is not None:
                                                    os.unlink(entry.name, dir_fd=destination)
                                                omit(path, str(error)[:200])
                                            finally:
                                                os.close(original)
                                                if created is not None:
                                                    os.close(created)
                            finally:
                                os.close(parent)
                                os.close(destination)
                    finally:
                        for parent, destination, _ in stack:
                            os.close(parent)
                            os.close(destination)
                    digest = hashlib.sha256()
                    for path, file_hash in sorted(copied_hashes):
                        digest.update(path.encode("utf8", "surrogateescape") + b"\0" + file_hash)
                    row["treeSha256"] = digest.hexdigest()
                except (OSError, ValueError) as error:
                    omit("", str(error)[:200])
        if not report["requests"]:
            return None
        data = (json.dumps(report, ensure_ascii=True) + "\n").encode()
        if len(data) > SUMMARY:
            raise ValueError("retention summary exceeds bound")
        name = "retention-" + str(uuid.uuid4()) + ".json"
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=target)
        try:
            write_all(fd, data)
        finally:
            os.close(fd)
        report["summary"] = os.path.join(queue, "retained", job, name)
        return report
    finally:
        for fd in reversed(descriptors):
            os.close(fd)


if __name__ == "__main__":
    if len(sys.argv) != 5:
        raise SystemExit("usage: push-queue-retain.py snapshot queue job checked-sha")
    print(json.dumps(export(*sys.argv[1:])))
