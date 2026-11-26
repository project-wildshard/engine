/* One direct loopback request, independent of Safari and URL services. */
#define _POSIX_C_SOURCE 200809L
#define _DARWIN_C_SOURCE
#ifdef __APPLE__
#include <TargetConditionals.h>
#else
#define TARGET_OS_SIMULATOR 0 /* Host-only protocol controls. */
#endif
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>

static double now(void) {
    struct timespec value;
    clock_gettime(CLOCK_MONOTONIC, &value);
    return value.tv_sec + value.tv_nsec / 1e9;
}

static int report(const char *phase, int connected, int error) {
    printf("{\"simulator\":%s,\"phase\":\"%s\",\"connected\":%s,\"errno\":%d}\n",
           TARGET_OS_SIMULATOR ? "true" : "false", phase,
           connected ? "true" : "false", error);
    return strcmp(phase, "complete") == 0 ? 0 : 1;
}

static int wait_io(int fd, short events, double deadline) {
    double remaining = deadline - now();
    if (remaining <= 0) { errno = ETIMEDOUT; return 0; }
    struct pollfd item = {fd, events, 0};
    int result = poll(&item, 1, (int)(remaining * 1000) + 1);
    if (result == 0) errno = ETIMEDOUT;
    return result > 0;
}

int main(int argc, char **argv) {
    if (argc != 3 || strlen(argv[2]) != 24 || strspn(argv[2], "0123456789abcdef") != 24)
        return report("arguments", 0, EINVAL);
    char *end;
    long port = strtol(argv[1], &end, 10);
    if (*end || port <= 1024 || port > 65535) return report("arguments", 0, EINVAL);
    (void)report("started", 0, 0);
    fflush(stdout); /* Distinguish native entry from a stalled spawn RPC. */
    double deadline = now() + 1; /* TCP work shares one second, never a retry. */
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return report("socket", 0, errno);
#ifdef SO_NOSIGPIPE
    int one = 1;
    setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof(one));
#endif
    if (fcntl(fd, F_SETFL, O_NONBLOCK) < 0) return report("socket", 0, errno);
    struct sockaddr_in peer = {0};
    peer.sin_family = AF_INET;
    peer.sin_port = htons((unsigned short)port);
    inet_pton(AF_INET, "127.0.0.1", &peer.sin_addr); /* No DNS or HTTP proxy. */
    if (connect(fd, (struct sockaddr *)&peer, sizeof(peer)) < 0 && errno != EINPROGRESS)
        return report("connect", 0, errno);
    if (!wait_io(fd, POLLOUT, deadline)) return report("connect", 0, errno);
    int error = 0;
    socklen_t size = sizeof(error);
    if (getsockopt(fd, SOL_SOCKET, SO_ERROR, &error, &size) < 0)
        return report("connect", 0, errno);
    if (error) return report("connect", 0, error);
    char request[256];
    int length = snprintf(request, sizeof(request),
        "GET /transport/%s HTTP/1.0\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n", argv[2]);
    ssize_t sent = send(fd, request, (size_t)length, 0);
    if (sent != length) return report("send", 1, sent < 0 ? errno : EIO);
    char response[2048];
    size_t used = 0;
    while (used < sizeof(response) - 1) {
        if (!wait_io(fd, POLLIN, deadline)) return report("receive", 1, errno);
        ssize_t count = recv(fd, response + used, sizeof(response) - 1 - used, 0);
        if (count < 0) return report("receive", 1, errno);
        if (count == 0) break;
        used += (size_t)count;
    }
    close(fd);
    response[used] = 0;
    char expected[64];
    snprintf(expected, sizeof(expected), "transport:%s", argv[2]);
    char *body = strstr(response, "\r\n\r\n");
    if (now() >= deadline) return report("receive", 1, ETIMEDOUT);
    if (strncmp(response, "HTTP/1.0 200 ", 13) || !body || strcmp(body + 4, expected))
        return report("response", 1, EPROTO);
    return report("complete", 1, 0);
}
