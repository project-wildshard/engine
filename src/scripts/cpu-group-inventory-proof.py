#!/usr/bin/env python3
"""Inject census races without querying or signalling any real PID."""
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('owned', Path(__file__).with_name('cpu-owned-command.py'))
owned = importlib.util.module_from_spec(spec)
spec.loader.exec_module(owned)
group, other = 100001, 100002
record = {'pid': group, 'identity': 'fixture:owned', 'uid': os.getuid(), 'group': group, 'parent': 1}
inventory = {pid: SimpleNamespace(pid=pid, uid=os.getuid(), zombie=False) for pid in (group, other)}
backend = SimpleNamespace(processes=lambda: (inventory, {0, group, other}))
asked = []


def check(condition, message):
    if not condition:
        raise AssertionError(message)


def read(pid):
    asked.append(pid)
    if pid <= 0:
        raise ValueError('process PID must be a positive integer')
    if pid == other:
        raise RuntimeError('Owned CPU process identity is unavailable')
    return record


def refuses(action, expected):
    try:
        action()
    except expected:
        return
    raise AssertionError('an unreadable owned member was ignored')


with patch.object(owned, 'identity_backend', return_value=backend), patch.object(owned, 'process_record', side_effect=read), patch.object(owned.os, 'killpg') as signals, patch.object(owned.os, 'kill') as pid_signals:
    with patch.object(owned.os, 'getpgid', side_effect=lambda pid: group if pid == group else other):
        members = owned.group_members(group, [record])
        check(members == [record] and other not in asked, 'an unrelated identity was queried')
    with patch.object(owned.os, 'getpgid', return_value=group):
        refuses(lambda: owned.group_members(group, [record]), RuntimeError)
        # A listed PID whose first census identity was unreadable must still
        # receive the group check and fresh identity read.
        del inventory[other]
        refuses(lambda: owned.group_members(group, [record]), RuntimeError)

    def disappeared(pid):
        if pid == other:
            raise ProcessLookupError()
        return group

    asked.clear()
    with patch.object(owned.os, 'getpgid', side_effect=disappeared):
        members = owned.group_members(group, [record])
        check(members == [record] and other not in asked, 'a disappeared PID was queried')

    def unreadable_group(pid):
        if pid == other:
            raise PermissionError()
        return group

    with patch.object(owned.os, 'getpgid', side_effect=unreadable_group):
        refuses(lambda: owned.group_members(group, [record]), PermissionError)
    with patch.object(owned.os, 'getpgid', return_value=group), patch.object(owned, 'process_record', side_effect=lambda pid: record if pid == group else {**record, 'pid': other, 'group': other}):
        check(owned.group_members(group, [record]) == [record], 'a PID leaving the group was included')
    signals.assert_not_called()
    pid_signals.assert_not_called()

print(json.dumps({'unrelatedChurnIndependent': True, 'ownedUnreadableRefused': True,
                  'disappearedPidIgnored': True, 'noSignalsSent': True}))
