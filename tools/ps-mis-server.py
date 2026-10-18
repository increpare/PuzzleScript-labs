"""Serve the local MIS release with room for parallel browser asset requests."""

import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class MISServer(ThreadingHTTPServer):
    # A page and its workers request many scripts together. The stdlib's small
    # default listen queue can refuse connections under Windows browser loads.
    request_queue_size = 128


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--directory', required=True)
    args = parser.parse_args()
    handler = partial(SimpleHTTPRequestHandler, directory=args.directory)
    with MISServer(('127.0.0.1', args.port), handler) as server:
        print(f'PS+MIS: http://localhost:{args.port}/mis.html', flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
