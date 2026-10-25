---
name: imagegen
description: Turn a request into a finished picture with the local ComfyUI — clarify only when the brief is genuinely thin, write the prompt, pick a template, run it, and show the result. Use whenever someone asks for an image to be made or changed: "画一张…", "生成一张海报", "帮我配个图", "把这张图改成…", "再来一版". Also use when a previous generation needs a re-roll, a size change, or a different style. Not for describing images that already exist.
license: MIT
metadata:
  version: "0.1.0"
  author: dsh-comfy-imagegen contributors
---

# Image Generation

You are the art director and the operator at once. The user says what they want;
you decide what the frame contains, which model here can actually render it, and
then you run it. Never hand the user a prompt to paste somewhere else, and never
claim a picture exists before `image_generate` returned one.

## Step 1 — Is the brief thick enough to shoot?

Ask only when the picture could go several genuinely different ways. Two to
three questions, never a questionnaire, and never for details you can decide
yourself.

Worth asking:

- **What it is for** — a poster, a product shot, a thumbnail, a character sheet.
  This changes framing, density, and how much text is allowed.
- **What must be in it** — the product, the name, an exact line of copy, a
  particular person or object. Guessing here produces a beautiful wrong picture.
- **What it must not be** — "not corporate", "no people", "don't make it cute".

Not worth asking: lighting, lens, palette, composition, texture, mood adjectives,
aspect ratio (pick one and say what you picked). Those are the parts you are
supposed to know.

If the brief is one noun with no direction ("画个猫"), ask the two questions that
unlock it — what it is for, and what feeling it should carry — then shoot. If the
user already gave direction, shoot first and offer variants after.

When the user is editing a picture they already have, do not re-shoot from
scratch: the change is an edit. Read the existing picture, state in one line what
becomes what, and only then act.

## Step 2 — Write the prompt

Use the `prompt-director` skill in this same package. It already carries the
triage questions, the target profiles (`caption` | `instruction` | `tag`), the
density table, and the ban on quality-booster filler. Follow it exactly:

- one continuous paragraph describing the finished frame;
- quoted in-image text keeps its own script — Chinese copy stays Chinese;
- no "masterpiece, 8k, best quality".

The template you pick decides the dialect. `caption` is the default everywhere;
`tags` for an anime tag model; `layout-json` when position must be exact.

## Step 3 — Pick a template, not a model name

`image_capabilities` reports what this machine can actually run. Prefer its
answer over your assumptions, and re-read it if the user says a model is
installed now.

| the picture is | `purpose` | pick the template that |
| --- | --- | --- |
| anime, manga, character art | `anime` | was made for illustrated characters |
| poster, cover, anything with real text | `typography` | renders legible type |
| layout-exact, dense Chinese copy | `layout` | places elements at fixed positions |
| photographic, painterly, stylised | `art` | has the widest aesthetic range |
| change a picture the user already has | `edit` | takes a source image |

The purpose tags are conventions, not a closed list — a template can declare any
tag it likes, and `image_capabilities` prints what each one is for in its notes.
Name a template directly only when the user names one or a previous run already
proved the fit.

Bundled templates are examples tied to the author's own model files; on your
machine most of them will fail their self-check until you point the plugin at
your own workflows. That is expected, and the fix is configuration, not code.

A template whose self-check fails is not a bug to work around: the error names
the missing file, and the honest move is to tell the user that file is missing,
offer the templates that do work, or edit the template to point at a file they
have.

## Step 4 — Run it

- `prompt` — the finished paragraph. Required.
- `purpose` — narrows template choice. `template` — only when the user names one.
- `size` — `3:4`, `16:9`, `1024x1365`, or `portrait`; omit for the template's
  native size. Pick a ratio that suits the subject and say what you picked.
- `batch` — more than one only when the user asked for options. Each image in a
  batch shares one prompt and seed, so they differ only by sampler noise.
- `seed` — pass a previous seed to prove a tweak helped, or to reproduce.
- `image` — for edit templates: the local absolute path or URL of the source
  picture. Write the prompt as an instruction that points at it (`<image1>`),
  saying what becomes what and what must stay; the output keeps the source shape.

- `params` — any other knob the chosen template exposes
  (`sampler_name`, `scheduler`, `denoise`, a second seed, an upscale factor):
  pass it as an object keyed by the slot name `image_capabilities` printed under
  「槽位」. `params` beats the named arguments above; keys the template never
  declared come back in `ignoredParams`, so check that array instead of assuming
  the knob took effect. Use it to answer "try a different sampler" or "how does
  this look at 8 steps" without editing any file.

Leave `steps` and `cfg` alone unless the user is debugging the picture; the
templates ship with trained values.

## Step 5 — Present

The tool already puts the images in the conversation. Do not repeat them, do not
describe them back, do not write your own markdown image link. One or two
sentences: which template ran, the seed (so a re-roll is possible), and the
concrete thing you would change next time. If the result missed, say what
missed and re-run with the prompt fixed — do not blame the model.

For a re-roll: same prompt, no seed. For a variation: same seed, one changed
clause. For "bigger": `size` up, and let the template have the extra pixels.
