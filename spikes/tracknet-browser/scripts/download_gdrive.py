#!/usr/bin/env python3
"""Download a Google Drive artifact after an explicit user request.

This is for obtaining a local model artifact during the spike only. The
browser harness never downloads weights or sends frames to a service.
"""
import argparse
import http.cookiejar
import html
import pathlib
import re
import urllib.parse
import urllib.request


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--id', required=True, help='Google Drive file id')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    url = 'https://drive.google.com/uc?' + urllib.parse.urlencode({'export': 'download', 'id': args.id})
    response = opener.open(url)
    content_type = response.headers.get('Content-Type', '')
    body = response.read()
    if 'text/html' in content_type:
        text = body.decode('utf-8', 'replace')
        action = re.search(r'<form[^>]+action="([^"]+)"', text)
        fields = dict(re.findall(r'<input[^>]+name="([^"]+)"[^>]+value="([^"]*)"', text))
        if not action:
            raise RuntimeError('Google Drive did not return a download form; inspect the link manually')
        fields.setdefault('id', args.id)
        next_url = html.unescape(action.group(1)) + '?' + urllib.parse.urlencode(fields)
        response = opener.open(next_url)
        body = response.read()
        content_type = response.headers.get('Content-Type', '')
    if 'text/html' in content_type or body[:20].lower().startswith(b'<!doctype html'):
        raise RuntimeError('Google Drive returned HTML instead of the artifact (permission or confirmation changed)')
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(body)
    print(f'{output} ({len(body)} bytes)')


if __name__ == '__main__':
    main()
