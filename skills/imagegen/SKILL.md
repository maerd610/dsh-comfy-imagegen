---
name: imagegen
description: >-
  Turn what the user asks for into a finished picture with the local ComfyUI:
  read the ask, expand it with prompt-director, run image_generate, end the turn
  with the picture. Use for 画一张 / 生成一张 / 帮我配个图 / 把这张图改成 / 再来一版,
  for re-rolls, size changes and style changes — not for describing images that
  already exist.
license: MIT
metadata:
  version: "0.3.0"
  author: dsh-comfy-imagegen contributors
---

# Image Generation

You are the art director and the operator at once. The user says what they want;
you decide what the frame contains, which model here can actually render it, and
then you run it. Never hand the user a prompt to paste somewhere else, and never
claim a picture exists before `image_generate` returned one.

## The loop — every request, every round

1. **Read the ask.** Decide subject, usage, and ratio yourself. Ask a question
   only when the picture could go several genuinely different ways; two at most,
   never a questionnaire, never about lighting/lens/palette/composition.
2. **Expand the prompt with `prompt-director`.** This step is not optional, even
   for a one-word ask. Load that skill (the `skill` tool, name
   `prompt-director`) and follow it: triage, target profile, one continuous
   paragraph, quoted in-image text in its own script, no booster filler. When the
   skill is unavailable, write the paragraph by the rules under *Writing the
   prompt* below.
3. **Run it.** Call `image_generate` with the expanded paragraph. Say one short
   line as the card starts — what is being made and at what ratio. The card
   streams real sampler steps and the latent preview; do not narrate progress.
4. **Close the turn with the picture.** End the same turn. One or two sentences:
   the template that ran, the seed for a re-roll, the one thing you would change
   next. Then let the result show — the tool already put the image in the
   conversation; if you want it in your summary line, reuse the path `image_generate`
   returned rather than inventing a URL.

Do not review the picture's quality on your own. No "看起来很干净", no
"需要我检查一下吗", no re-describing what is visible. Quality checks happen only
when the user asks for one.

The next request — a re-roll, a different subject, a size change — starts the
loop again at step 1. Re-read the new ask; do not recycle the previous prompt.

## Writing the prompt

One continuous paragraph describing the finished frame, usually 150–280 words —
the density comes from what the frame carries, not from a quota:

- subject and action first, then the objects and where they sit relative to each
  other, then light, then surface and texture;
- abstract words become visible evidence: "quiet" is one broken tube light and an
  empty row of seats, not the word quiet;
- one or two concrete traces that belong only to this frame — something put down,
  worn, half-used — they buy more than another adjective;
- quoted copy keeps its script — Chinese words stay Chinese, and you say where
  they sit ("the line across the top third");
- no "masterpiece, 8k, best quality, ultra-detailed", no lens/ISO kit unless the
  user asked for a photographic look;
- aspect ratio goes in `size`, not in the prose.

The template decides the dialect: `caption` is the default, `tags` for an anime
tag model, `layout-json` when position must be exact.

## Pick a template, not a model name

| the picture is | `purpose` | pick the template that |
| --- | --- | --- |
| anime, manga, character art | `anime` | was made for illustrated characters |
| poster, cover, anything with real text | `typography` | renders legible type |
| layout-exact, dense Chinese copy | `layout` | places elements at fixed positions |
| photographic, painterly, stylised | `art` | has the widest aesthetic range |
| change a picture the user already has | `edit` | takes a source image |

Name a template directly only when the user names one or a previous run proved
the fit. `image_capabilities` is for exactly two moments: the user asks what
models are available, or a run failed and you need to know which file is missing.
Do not call it before every generation.

Bundled templates are examples tied to the author's own model files; most fail
their self-check until the plugin points at your workflows. A failing self-check
is not a bug to work around: the cards name the missing file — say so, offer the
templates that do work, or edit the template to point at a file you have.

## Running it

- `prompt` — the expanded paragraph. Required.
- `purpose` narrows template choice; `template` only when the user names one.
- `size` — `3:4`, `16:9`, `1024x1365`, or `square`/`portrait`/`landscape`; omit
  for the template's native size. Pick what suits the subject and say what you
  picked.
- `batch` — more than one only when the user wants options; a batch shares one
  prompt and seed, so the frames differ only by noise.
- `seed` — a previous seed to prove a tweak helped, or to reproduce.
- `image` — for edit templates: absolute path or URL of the source picture.
- `params` — any other knob the template exposes (`sampler_name`, `scheduler`,
  `denoise`, an upscale factor), keyed by the slot name `image_capabilities`
  prints under 「槽位」. It beats the named arguments; keys the template never
  declared come back in `ignoredParams`, so check that array instead of assuming
  it took effect.

Leave `steps` and `cfg` alone unless the user is debugging the picture.

## Editing a picture the user already has

Do not re-shoot from scratch. Read the existing picture, state in one line what
becomes what, and pass it as `image`. Write the prompt as a delta plus its
invariants: what changes, and what must stay exactly as it is ("the face, hair
and window light unchanged"). The output keeps the source's shape, so `size` is
ignored.

## When something goes wrong

- **连不上 ComfyUI** — ComfyUI is not running, or `baseUrl` is wrong. Say that
  plainly; do not retry in a loop.
- **模板缺少文件** — run `image_capabilities`, name the missing file, and offer
  the templates that do run here.
- **任务结束了但没有产出图片 / 执行失败** — report the error text. Do not claim
  success, do not silently re-run more than once with the same prompt; fix the
  prompt and say what you changed.

## Re-rolls and variations

Re-roll: same prompt, no seed. Variation: same seed, one changed clause. Bigger:
raise `size` and let the template use the extra pixels.
