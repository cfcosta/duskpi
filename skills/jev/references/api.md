# TypeSafe HTTP API

This file gives the wire format (OpenAPI 0.2.0, November 2026). All TypeSafe SDKs send these requests. If the project uses an SDK, read its installed types for the local names. Some SDKs change Score keys to integers.

Sources: `https://api.typesafe.ai/openapi.json`, `https://docs.typesafe.ai/api/errors.md`, `https://docs.typesafe.ai/models.md`, `https://docs.typesafe.ai/images.md`.

## Endpoints

| Item | Value |
| - | - |
| Questions | `POST https://api.typesafe.ai/v1/systemone` |
| Models | `GET https://api.typesafe.ai/v1/models` → `{"models": [{"name", "description", "release_date"}]}`. The list shows aliases. Versioned IDs also work. |
| Authentication | `Authorization: Bearer <key>`. Keep the key on the server (usually `TYPESAFE_API_KEY`). |
| Body | `application/json` (UTF-8, no BOM), or `multipart/form-data` for image files |
| Images | `TypeSafe-Danger-Zone-Images: true` on each request with an image or a Box. Without it, you get 400. |
| Long context | `TypeSafe-Danger-Zone-Long-Context: true` |
| Compression | `Content-Encoding: gzip` or `zstd`. Use one layer. The zstd window is 8 MiB or less. |
| Request ID | Response header `x-typesafe-request-id` |
| Gateways | OpenRouter (model `~typesafe/jev-latest`), Vercel AI Gateway (`typesafe-ai/jev`), Pydantic AI Gateway |

## Request

```json
{"model": "jev-1.14.0",
 "state": "string, object, or array",
 "questions": {
   "q1": {"type": "noul", "instructions": "...", "criteria": {"true": "...", "false": "..."}},
   "q2": {"type": "choice", "instructions": "...", "criteria": {"option_name": "description or null"}},
   "q3": {"type": "score", "instructions": "...", "criteria": ["level 0", "level 1", "level 2"]},
   "q4": {"type": "box", "instructions": "..."}},
 "assets": {"<reference>": {"type": "image", "format": "jpg", "data_base64": "..."}}}
```

- `model` is necessary on the wire. SDKs use `jev-latest` as the default.
- `state` cannot be `null`.
- `questions` must have one or more entries. There is no maximum number. Jev does not see the IDs.
- Choice `criteria` has 1–255 options. The API rejects 256.
- Score `criteria` has 2–10 levels, from low to high. A Score level cannot be `null`.
- Noul `criteria` is optional. Each side is optional.
- Box has no `criteria`.
- Each `instructions` value, option description, Score level, and Noul side can be a string, an object, or an array. Object keys are free labels. Jev reads the keys and the values.

## Response

```json
{"model": "jev-1.14.0",
 "answers": {
   "q1": {"type": "noul", "noul": 0.99},
   "q2": {"type": "choice", "choice": "returns", "confidence": 0.42, "probabilities": {"returns": 0.61, "billing": 0.35, "shipping": 0.04}},
   "q3": {"type": "score", "score": 1.43, "confidence": 0.35, "legend": {"0": "...", "1": "...", "2": "..."}, "probabilities": {"0": 0.0, "1": 0.57, "2": 0.43}},
   "q4": {"type": "box", "box": {"top": 0.25, "bottom": 0.82, "left": 0.44, "right": 0.84}, "confidence": 0.92}},
 "usage": {"input_tokens": 589, "output_tokens": 212}}
```

- `model` is the versioned ID that answered, also when you send an alias. Log it.
- Score `legend` and `probabilities` use the level index as a string key.
- Box edges are fractions of the image height (`top`, `bottom`) and width (`left`, `right`), from the top-left corner. Box `confidence` can be `null`.
- Ignore unknown fields. Log and skip unknown answer types.

## Limits

| Limit | Value |
| - | - |
| Body | 32 MiB or less, before and after decompression. More gives 413. |
| Nesting | 64 levels or less in each of `state`, `instructions`, and `criteria` |
| Numbers | Finite numbers only. Send IDs and large exact numbers as strings. |
| Context | 64k tokens for the state and all questions. 32k tokens for the state and one question. |
| Long context | 262k tokens for the two limits. The price is the same. The request is slower and less accurate. |
| Rate | Each organization has a limit in tokens and requests for each second. |

## Errors

| Status | Cause | Action |
| - | - | - |
| 400 | Rule violation, `max_tokens_exceeded`, no image header, rejected image | Correct the request |
| 401, 403, 404 | Key or permission problem | Stop and show the error |
| 413 | Body or image too large | Make the request smaller or divide it |
| 415 | Unknown `Content-Encoding` or two layers | Correct the encoding |
| 422 | Validation error. `detail[].loc` gives the field. | Correct the field |
| 408, 429, 5xx, 529 | Timeout, rate limit, server error, overload | Retry with exponential backoff. Obey `retry-after`. |

## Models

| ID | Released | Question types |
| - | - | - |
| `jev-1.14.0` | 2026-10-14 | Choice, Score, Noul, Box |
| `jev-1.13.0` | | Choice, Score, Noul |

The two models cost $0.042 for each million input tokens. Output tokens are free. The two models accept text and PNG or JPEG images.

`jev-latest` and `jev-preview` point to `jev-1.14.0` at this time. An alias can change without a change to your code. Use a versioned ID after you tune thresholds. TypeSafe does not train Jev on customer requests.

## Images (experimental)

Put each image one time in `assets`, with a reference string as its key. Write the reference where the image must be: as a full string value or in a longer string. Jev then sees the image at that location.

- Use a new UUID for each reference. References match as plain text in all strings, so `cat` also matches in `category`.
- Each asset must have a reference in `state`, `instructions`, or `criteria`. If not, you get 400.
- Object keys are not replaced. To show an option as a picture, put the reference in its description.
- Each use of a reference adds one more copy of the image to the input.
- A reference is 1,024 bytes or less. All references together are 65,536 bytes or less.
- SDKs make the references for you. One SDK sends an unattached reference as plain text, without an error.

Use multipart when possible. Base64 makes each image approximately one third larger.

```bash
curl https://api.typesafe.ai/v1/systemone \
  -H "Authorization: Bearer $TYPESAFE_API_KEY" -H "TypeSafe-Danger-Zone-Images: true" \
  -F 'request={"model": "jev-1.14.0", "state": {"door": "a3f1c2e8-door"},
    "assets": {"a3f1c2e8-door": {"type": "image", "part": "door-photo"}},
    "questions": {"person": {"type": "noul", "instructions": "Is there a person in `door`?"}}};type=application/json' \
  -F 'door-photo=@door.jpg;type=image/jpeg'
```

- The first part has the name `request` and contains the JSON body.
- Each image part has a unique name and belongs to one asset only.
- For base64, use `data_base64` (standard alphabet, no line breaks, no `data:` prefix) and `format` (`png`, `jpg`, or `jpeg`).

| Image limit | Value |
| - | - |
| Format | PNG or baseline JPEG stills. Animated PNG is rejected. |
| File | 16 MiB or less |
| Dimensions | Each side 280–1568 px. Total 78,400–2,458,624 px. |
| All images, expanded request | 32 MiB or less each |

The API rejects an image that is out of limits. It does not resize it. One bad image stops the full request.

Prepare each image:

1. Apply the EXIF orientation to the pixels. The API removes metadata and does not apply the orientation.
2. Make the longest side 1568 px or less.
3. If a side is less than 280 px, increase the size or add padding. Record the padding, so that you can map Box values back.
4. Save as baseline JPEG (quality approximately 90) or PNG.

To get pixels from a Box, multiply `left` and `right` by the width, and `top` and `bottom` by the height.

## Client behavior

The official SDKs do these steps. A custom client must do them too.

- Retry 408, 429, 5xx, connection errors, and timeouts two times. Use exponential backoff from 0.5 s to 5 s, with jitter. Obey `retry-after`.
- SDK timeouts are approximately 10 s for each attempt. For large states, use 60–300 s and more retries.
- Use one client and one connection pool. Under heavy thread load, use one client for each thread.
- Compress bodies of 1 KiB or more.
- Log the request ID, the model ID, the usage, and the answers. Do not log sensitive bodies.
- Do not call the API from a browser with a real key.
