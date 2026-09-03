#!/usr/bin/env python3
"""Legacy demo-asset helper; not part of the ChatGPT Work or Codex Site tools runtime.

Generate ONE image via the Gemini image REST API and write it to a file.

The adapter itself is built for ChatGPT Work and Codex in the ChatGPT desktop
app's built-in browser. This standalone helper predates that product boundary.

This is a plain HTTPS call to the Google Generative Language API — NOT the
`gemini` CLI (that only emits text and cannot produce an image file). It reads
the key from the GEMINI_API_KEY environment variable, which the USER must
provide; each call is a paid request billed to that key.

Usage:
  GEMINI_API_KEY=... python3 gen-image.py <model> <aspect> <out.jpg> "<prompt>"
    model   e.g. gemini-3-pro-image  (or imagen-4.0-generate-001)
    aspect  e.g. 16:9 (hero) | 1:1 (card) | -  (omit aspect ratio)
    out     output path; bytes are JPEG, so use a .jpg name
    prompt  passed as one argv, so no shell-escaping of quotes

Exits non-zero with a message on any failure (HTTP error, or a response that
carried no image) — it never writes an empty file and calls it done.
"""
import base64
import json
import os
import sys
import urllib.error
import urllib.request

if len(sys.argv) != 5:
    sys.exit(__doc__)
model, aspect, out, prompt = sys.argv[1:5]

key = os.environ.get("GEMINI_API_KEY")
if not key:
    sys.exit("GEMINI_API_KEY is not set — the user must provide their own key.")

generation_config = {"responseModalities": ["TEXT", "IMAGE"]}
if aspect and aspect != "-":
    generation_config["imageConfig"] = {"aspectRatio": aspect}
body = json.dumps(
    {"contents": [{"parts": [{"text": prompt}]}], "generationConfig": generation_config}
).encode()

url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
headers = {"Content-Type": "application/json", "x-goog-api-key": key}

# The image endpoint 404s intermittently; a couple of retries rides it out.
resp = None
for attempt in range(4):
    try:
        with urllib.request.urlopen(
            urllib.request.Request(url, body, headers), timeout=180
        ) as r:
            resp = json.load(r)
        break
    except urllib.error.HTTPError as e:
        if e.code in (404, 429, 500, 503) and attempt < 3:
            continue
        sys.exit(f"HTTP {e.code}: {e.read().decode()[:300]}")
    except urllib.error.URLError as e:
        if attempt < 3:
            continue
        sys.exit(f"request failed: {e}")

if resp is None:
    sys.exit("no response from the API after retries.")
if "error" in resp:
    sys.exit(f"API error: {resp['error'].get('message', '')[:300]}")

for part in resp["candidates"][0]["content"]["parts"]:
    inline = part.get("inlineData") or part.get("inline_data")
    if inline:
        data = base64.b64decode(inline["data"])
        with open(out, "wb") as f:
            f.write(data)
        print(f"OK {out} {len(data)} bytes")
        sys.exit(0)

sys.exit("no image in the response (safety block, or a text-only reply).")
