"""Mark gameplay URLs for the testing drivers that open a native Safari tab."""

import json
import os
from pathlib import Path
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

QUERY = json.loads(
    (Path(__file__).resolve().parent.parent.parent / 'src/shared/engine/app/actorMarkers.json').read_text()
)['query']


def agent_url(address):
    url = urlsplit(address)
    if url.scheme not in ('http', 'https'):
        return address
    if any(key == QUERY and value for key, value in parse_qsl(url.query)):
        return address
    lane = os.environ.get('WS_LANE_NAME', '')
    if not re.fullmatch(r'[a-z0-9][a-z0-9._-]{0,63}', lane, re.IGNORECASE | re.ASCII):
        lane = '1'
    marker = urlencode({QUERY: lane})
    query = f'{url.query}&{marker}' if url.query else marker
    return urlunsplit(url._replace(query=query))
