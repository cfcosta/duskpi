# TypeSafe HTTP API reference

The wire format for Jev (OpenAPI 0.2.0, November 2026). It is language-neutral: every TypeSafe client SDK wraps these same requests and responses, and any HTTP client can call them directly. When a project uses an SDK, read its installed types for the local spelling of these fields (some languages rename `system_one`/`systemOne`, convert Score keys to integers, and so on) instead of guessing.

Live sources: `https://api.typesafe.ai/openapi.json`, `https://docs.typesafe.ai/api/system-one.md`, `https://docs.typesafe.ai/api/errors.md`, `https://docs.typesafe.ai/models.md`, `https://docs.typesafe.ai/images.md`, `https://docs.typesafe.ai/sdk.md` (official SDKs).

---

## Endpoints

| | |
| - | - |
| Ask questions | `POST https://api.typesafe.ai/v1/systemone` |
| List models | `GET https://api.typesafe.ai/v1/models` → `{"models": [{"name", "description", "release_date"}]}`. Lists aliases; versioned IDs are accepted even when unlisted. |
| Auth | `Authorization: Bearer <API_KEY>`. Keep the key on the server, read from the environment (conventionally `TYPESAFE_API_KEY`). |
| Body | `application/json` (UTF-8, no BOM), or `multipart/form-data` when uploading image files |
| Opt-in headers | `TypeSafe-Danger-Zone-Images: true` on every request with an image or a Box question (otherwise 400). `TypeSafe-Danger-Zone-Long-Context: true` for 262k context. Neither is added for you. |
| Compression | `Content-Encoding: gzip`, `x-gzip`, or `zstd`; one layer; zstd window ≤ 8 MiB. Worth it for large states. |
| Request ID | response header `x-typesafe-request-id`; log it with every result |
| Gateways | Also served through OpenRouter (`https://openrouter.ai/api`, model `~typesafe/jev-latest`), Vercel AI Gateway (`https://ai-gateway.vercel.sh/typesafe`, model `typesafe-ai/jev`), and Pydantic AI Gateway (`https://gateway-us.pydantic.dev/proxy/typesafe`), each with its own key |

---

## Request

```json
{
  "model": "jev-1.14.0",
  "state": "a string, a JSON object, or an array (not null)",
  "questions": {
    "<id>": {"type": "noul",   "instructions": "...", "criteria": {"true": "...", "false": "..."}},
    "<id>": {"type": "choice", "instructions": "...", "criteria": {"<option>": "description, object, array, or null"}},
    "<id>": {"type": "score",  "instructions": "...", "criteria": ["level 0 (lowest)", "level 1", "level 2"]},
    "<id>": {"type": "box",    "instructions": "..."}
  },
  "assets": {
    "<reference>": {"type": "image", "format": "jpg", "data_base64": "..."}
  }
}
```

| Field | Rules |
| - | - |
| `model` | Model ID or alias. Required on the wire (SDKs default it to `jev-latest`). |
| `state` | String, object, or array; may contain image references. No audio or video. |
| `questions` | Map of your IDs to questions; at least one; **no maximum count** (only context limits). IDs are never sent to the model. |
| `assets` | Optional map of reference strings to images; every reference must appear somewhere in `state`, `instructions`, or `criteria`. |

| Question | `instructions` | `criteria` |
| - | - | - |
| `noul` | the yes/no question or a statement to judge | optional `{"true": ..., "false": ...}`; either side may be omitted |
| `choice` | the question | required map of option name → description (`null` = the name speaks for itself); 1–255 options, 256 rejected; ~240 reliable; ~40 when each description is a long passage |
| `score` | what is rated | required ordered array, low → high; use 2–10 levels (some SDKs reject a single level); no `null` levels |
| `box` | what to find, and in which image | none |

Every `instructions` value, Choice option description, Score level, and Noul `true`/`false` accepts a string, an object, or an array (and `null`, except Score levels). Object keys are free-form labels the model reads along with the values (`question`, `focus`, `compare`, `inspect`, `what`, `not_for`, `examples`, `signals`, ...). None are reserved. Option names are sent to the model and come back as `choice`.

Structured instructions example:

```json
"requests_credentials": {
  "type": "noul",
  "instructions": {
    "question": "Does the message request a sensitive credential?",
    "compare": ["`ticket.message`", "`policy.sensitive_credentials`"],
    "focus": "Look for a request to disclose the credential itself."
  },
  "criteria": {
    "true": {"what": "Asks the recipient to disclose a listed credential", "examples": ["Reply with your password"]},
    "false": {"what": "Does not ask the recipient to disclose a credential", "not_for": "A legitimate instruction to reset a credential", "examples": ["Use this link to reset your password"]}
  }
}
```

Taxonomy walking: a Choice option's description can be that branch's subtree (an object of children), so the model sees what lives under a branch. Trim large subtrees to direct children plus a sample of leaves.

---

## Response

```json
{
  "model": "jev-1.14.0",
  "answers": {
    "dept":   {"type": "choice", "choice": "returns", "confidence": 0.42,
               "probabilities": {"returns": 0.61, "billing": 0.35, "shipping": 0.04}},
    "sev":    {"type": "score", "score": 1.43, "confidence": 0.35,
               "legend": {"0": "...", "1": "...", "2": "..."},
               "probabilities": {"0": 0.0, "1": 0.57, "2": 0.43}},
    "urgent": {"type": "noul", "noul": 0.99},
    "mug":    {"type": "box", "box": {"top": 0.25, "bottom": 0.82, "left": 0.44, "right": 0.84}, "confidence": 0.92}
  },
  "usage": {"input_tokens": 589, "output_tokens": 212}
}
```

| Answer | Fields |
| - | - |
| `choice` | `choice`: the option with the highest probability. `probabilities`: every option, summing to 1. `confidence`: `(p_max − 1/n)/(1 − 1/n)`. |
| `score` | `score`: Σ level × probability, from 0 to n−1. `probabilities` and `legend` are keyed by level index (strings on the wire). `confidence`: distance-weighted spread (see SKILL.md §7). |
| `noul` | `noul`: P(yes), 0–1. No confidence. |
| `box` | `box`: `top`/`bottom` as fractions of image height, `left`/`right` as fractions of width, from the top-left corner (`left < right`, `top < bottom`). `confidence`: 0–1, or `null`. |

- `model` is the versioned ID that answered, even when you sent an alias.
- `usage` token counts can be `null` in some SDK typings; only input tokens are billed.
- Handle unknown answer `type`s gracefully (log and skip). Newer models may add types.
- A Box answer always contains a box, even for an absent target. A Choice answer always names an option.

---

## Limits

| Limit | Value |
| - | - |
| Body | ≤ 32 MiB, compressed and decompressed (413 above) |
| Nesting | ≤ 64 levels in each of `state`, `instructions`, and `criteria` (400 above); flatten deeper content |
| Numbers | finite only (`NaN`, `Infinity`, and `1e400` are rejected); send IDs and huge exact quantities as strings |
| Context, default | 64k tokens per request (state + all questions); 32k per question (state + that question) |
| Context, long | 262k for both with `TypeSafe-Danger-Zone-Long-Context: true`; same price, slower, less accurate |
| Overflow | 400 with `max_tokens_exceeded` |
| Rate limits | per organization, in tokens/s and requests/s; see `https://console.typesafe.ai/rate-limits` |

## Errors

| Status | Meaning | Client behavior |
| - | - | - |
| 400 | Rule violation, `max_tokens_exceeded`, images not enabled, rejected image/asset; body `{"detail": string or object}` | fix the request; do not retry as-is |
| 401 | Missing or invalid key | fail loudly |
| 403 / 404 | Permission denied / not found | fail loudly |
| 408 | Timeout | retry with backoff |
| 413 | Body, image, or expanded request too large | shrink or split |
| 415 | Unsupported or multiple `Content-Encoding` layers | fix the encoding |
| 422 | Validation failure; `detail: [{"loc": [...], "msg", "type", "input"?, "ctx"?}]` names the field | fix the field named in `loc` |
| 429 | Rate limited | retry with exponential backoff, honoring `retry-after` |
| 5xx, 529 | Server error / overloaded | retry with exponential backoff |

A failed call is an error, not an answer. Never let it fall through as "no", as the first option, or as the default branch.

---

## Models

| ID | Released | Price | Context | Input | Question types |
| - | - | - | - | - | - |
| `jev-1.14.0` | 2026-10-14 | $0.042 per million input tokens; output free | 64k / 32k | text; PNG/JPEG images | Choice, Score, Noul, Box |
| `jev-1.13.0` | | same | same | text; images | Choice, Score, Noul |

| Alias | Points to | Meaning |
| - | - | - |
| `jev-latest` | `jev-1.14.0` | latest stable release; SDK default |
| `jev-preview` | `jev-1.14.0` | latest release, official or not; moves ahead of `jev-latest` when a preview exists |

Aliases move without any change to your code, and answers can change with them. Pin the versioned ID once thresholds are tuned, and switch deliberately after re-checking. Jev is not fine-tuned per customer; customer requests are not used for training; zero data retention is available on enterprise plans.

---

## Images (experimental, "dreamer-ready")

Every request with an image or a Box question needs `TypeSafe-Danger-Zone-Images: true`. Box needs `jev-1.14.0` or later; images work on 1.13 and 1.14.

### Referencing

Each image is listed once in the top-level `assets` map under a reference string. Write the reference wherever the image belongs (a whole string value, or inside a longer string) and the model receives the image there.

```json
{
  "model": "jev-1.14.0",
  "state": {"photo": "a3f1c2e8-found"},
  "assets": {
    "a3f1c2e8-found":  {"type": "image", "format": "jpg", "data_base64": "/9j/4AAQ..."},
    "77b0d4a1-poster": {"type": "image", "format": "jpg", "data_base64": "/9j/4AAQ..."}
  },
  "questions": {
    "same_dog":   {"type": "noul", "instructions": "Is the dog in `photo` the same dog as in this picture: 77b0d4a1-poster?"},
    "dog_present": {"type": "noul", "instructions": "Is there a dog in `photo`?"},
    "dog":        {"type": "box",  "instructions": "the dog in `photo`"}
  }
}
```

- References match as plain text anywhere in the request's strings, so use ones that can't occur by accident: a fresh UUID per image per request. A short reference like `cat` would also match inside `category`.
- A string that is exactly a reference becomes the image. In longer strings, references are replaced left to right without overlap.
- Object keys are never replaced. To define a Choice option by a picture, put the reference in its description: `"thumbs_up": "0b6c51aa-thumb"`, or `{"description": "...", "examples": ["<ref>", "<ref>"]}`.
- Every use of a reference adds another copy of the image to the input (and to the expanded-size limit). An image several questions need goes in `state` once and is referenced by path.
- Answers that echo criteria (a Score `legend`) contain the reference string, not the image.
- An asset nobody references → 400. Each reference ≤ 1,024 UTF-8 bytes; all references together ≤ 65,536.
- Client SDKs generate references and upload files for you. One SDK sends a reference string that isn't attached as plain text without an error, so check that every reference you write is attached.

### Uploading

Prefer multipart: it sends files as-is, while base64 inflates them by about a third, which counts against the 32 MiB body.

```bash
curl https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" \
  -H "TypeSafe-Danger-Zone-Images: true" \
  -F 'request={
    "model": "jev-1.14.0",
    "state": {"door": "a3f1c2e8-door"},
    "assets": {"a3f1c2e8-door": {"type": "image", "part": "door-photo"}},
    "questions": {"person_present": {"type": "noul", "instructions": "Is there a person in `door`?"}}
  };type=application/json' \
  -F 'door-photo=@door-camera.jpg;type=image/jpeg'
```

- The first part is named `request` and holds the JSON body (`application/json`).
- Each image is its own part with a unique, non-empty name (`request` is reserved), content type `image/png`, `image/jpeg`, `image/jpg`, `application/octet-stream`, or none.
- Each part belongs to exactly one asset's `part`; an orphan part, a shared part, or a missing part → 400.
- Base64 instead: `data_base64` (standard alphabet, `=` padding, no line breaks, no `data:` prefix) plus `format` (`png`, `jpg`, `jpeg`). If both `part` and `data_base64` are set, `part` wins.

### Limits

| Limit | Value |
| - | - |
| Format | PNG or JPEG stills; animated PNG rejected; convert GIF, WebP, HEIC; re-save progressive JPEGs as baseline |
| File | ≤ 16 MiB each (after base64 decoding) |
| Dimensions | each side 280–1568 px; total pixels 78,400–2,458,624 |
| All images | ≤ 32 MiB after server processing (re-encoding can grow files) |
| Expanded request | ≤ 32 MiB after every reference is replaced by its image |

All limits are inclusive. Out-of-range images are rejected, never resized, and one bad image fails the whole request with no partial answers. Images are billed as input tokens at the normal rate.

### Preparing images

1. Apply EXIF orientation to the pixels. The API strips all metadata and does **not** apply EXIF orientation, so a photo that looks upright locally can arrive sideways.
2. Scale so the longest side is ≤ 1568 px (a 12 MP phone photo becomes 1568 × 1176).
3. Upscale, or pad onto a plain canvas, anything with a side under 280 px. Record the padding offset so Box coordinates can be mapped back.
4. Save as baseline 8-bit JPEG (quality ~90) or PNG. Export video frames as stills.
5. If a file that opens fine is rejected, re-export it with a standard image library.

### Box coordinates

To pixels: `left × width`, `top × height`, `right × width`, `bottom × height`. For a crop or zoom, map coordinates back through each transformation (canvas → crop → page). Pad low-confidence boxes before cropping, clamped to 0–1.

---

## Client behavior to implement or expect

The official SDKs do the following by default. A hand-written client should do the same.

- **Retries:** about 2 retries, exponential backoff starting at ~0.5 s and capped at ~5 s, with jitter, on 408, 429, and 5xx (incl. 529) and on connection errors and timeouts. Honor `retry-after` / `retry-after-ms`. For large requests the cookbooks use ~5 retries with backoff up to 20–30 s.
- **Timeouts:** SDK defaults are about 10 s per attempt (one SDK also caps the total retry time at 30 s). Raise them to 60–300 s for large states or long-context requests.
- **Connections:** reuse one client/connection pool; creating a client per request pays TLS setup every time. Under heavy multi-threaded load, use one client per thread. HTTP/1.1 with a pool scales better at high request rates than a single HTTP/2 connection.
- **Concurrency:** batch questions per state first (the state dominates cost), then run independent requests concurrently, 4–12 in flight per shared key before 429s appear.
- **Compression:** compress bodies of 1 KiB or more with zstd (or gzip).
- **Logging:** log request ID, model ID, usage, and answers. Debug logging of full bodies leaks state; SDKs redact secret headers but not bodies.
- **Caching:** key on model ID + state + a canonical serialization of the questions (sorted-key JSON), so any wording change invalidates the entry. Store raw answers so thresholds can be retuned without new calls.
- **Forward compatibility:** ignore unknown response fields, skip unknown answer types with a warning, and don't send request fields the API doesn't document.
- **Browsers:** don't call the API from client-side code with a real key.
