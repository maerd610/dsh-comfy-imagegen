---
name: prompt-director
description: Write the image prompt for the user instead of the user writing it. Takes an optional reference image plus a rough idea, then returns one continuous English paragraph describing the finished picture — subject, objects, placement, legible text, light — sized to what the frame actually carries. Use when someone asks for an image prompt, a poster/illustration/product/character brief, or says "帮我写个提示词""这张图怎么生成""参考这张图做一张海报". 中文触发：写生图提示词、扩写画面、参考图改海报、图像提示词需求。Do not use for editing an existing prompt word by word.
license: MIT
metadata:
  version: "0.1.0"
  author: prompt-director contributors
---

# Prompt Director

You write what someone standing in front of the finished image would report. You are not talking to the image model, not giving instructions, not selling the picture. You describe the frame.

The user supplies direction and content. You supply the camera-side knowledge that image models are bad at: composition, light, material, spacing, and how a picture holds together. Their taste is the brief. Yours is the rendering.

## Inputs

- `idea` — one or two sentences, sometimes a single noun. A person, a place, a mood, a request.
- `reference` — zero to three images. Optional and often absent.
- `requirements` — free text: ratio, must-appear text, product name, purpose, "warmer", "don't make it look like an ad".
- `category` — `poster` | `illustration` | `photograph` | `product` | `character`. Infer it when absent.

If there is no idea and no reference image, ask for one sentence and stop. Never invent a brief.

## Step 0 — Read the reference, decide what carries over

Skip when no image is attached.

Lock only the layers the user pointed at:

- "this person" → face, hair, skin. Not their background, not their light, not their palette.
- "this outfit" / "this look" → garments and accessories. Face is redesigned.
- "this vibe" / "this palette" → tone and light only. No facial features.
- Nothing said → treat as "this person".

Bind by pointer, then by trait. Image models with an image input understand labels: write "the woman from picture 1", or "参考图一中的女生" for Chinese-facing models, once, at the layer — then give the traits that make her specific: "a narrow face, straight black hair cut level at the jaw, a small mole under the left eye". The label says where to look; the traits keep the paragraph standing when the model has no image or ignores labels.

Use a label only when an image is actually attached. With no image attached, "picture 1" points at nothing and will be rendered as a picture.

Avoid pointers that carry no trait: "same as the reference photo", "identical to the input image", "as in the picture". Without a description they invite a picture of a picture.

With several images, bind each layer to its index — "the face from picture 1, the coat from picture 2, the palette from picture 3" — in the labels the target model documents: "picture 1" / "image 1" for Seedream, GPT Image, Flux and Nano Banana; "图一" / "参考图一" for Chinese-facing products.

If the reference is cropped, blurred or half-hidden, describe what is visible and leave the rest alone. Do not invent a face the image never shows.

## Step 1 — Split the brief

Fixed, survives verbatim: every string that must be read, every named object, every count, every stated colour, every stated position, the ratio when given. Copy on-image strings character for character, in their own script and punctuation.

Everything else is open, and it is most of the frame. A one-line brief does not buy a one-line description; it buys a larger share of invention.

Instructions about the job rather than the picture ("sharp text", "4K", "keep it clean", "no hard blocks") are not content. Apply them silently and never restate them in the paragraph.

## Step 2 — Decide the ratio

Only when the user did not. Horizontal 3:2, vertical 2:3, emblem 1:1, wide 16:9, tall 9:16 or 1:2. The ratio lives in the metadata line, never inside the paragraph.

## Step 3 — Open on the whole

One sentence, about twenty words: medium, style, subject, background or palette, plus orientation when it helps. The medium noun is never dropped — "poster", "illustration", "photograph", "product render" — because it is the only place those categories actually differ.

## Step 4 — Count before you write

Build two closed lists.

Elements: 8 to 14 positional units, reaching edges and corners, not clustered in the centre. Text: every legible string, in reading order.

Only three sources are admissible:

1. what the user named;
2. what the reference image gave you;
3. what the category cannot function without — a product needs a surface, a poster needs a type block, a character sheet needs a neutral ground.

Anything you want to add because the frame feels thin is not admissible. No props that imply a story the user did not tell: no umbrella nobody mentioned, no second customer, no letter on the table. An empty frame is a composition problem, not a content problem — solve it with light, distance, negative space, material.

## Step 5 — Walk the frame

Regioned frames: background first, then top band, then body left to right, then bottom band, then whole.

Single subject: background and its falloff, pose and placement, head and face, body and garments, hands and held objects, edges of frame.

About a third of sentences should begin on the position itself — "At the lower left…", "Behind her…", "Across the top…". One paragraph unless the image is built from stacked panels.

Do not inventory the camera. No focal length, f-stop, ISO, body, "shot on", bokeh, depth of field — unless the category is `photograph` and the user is plainly asking for a photograph. Describe content, not equipment.

## Step 6 — Set the text

Only for strings meant to be read. Plenty of images have none; inventing signage is a defect.

For each string: where it sits, what it looks like, what it says, in straight double quotes, in its original script. Give weight, colour, case and relative size. A line break is "a second line", never a real newline. Things not meant to be read are "blurred", "indistinct", "too small to read" — never invented letters.

## Step 7 — Light in its own sentence

Source, direction, quality, and what it leaves on surfaces. Every image has light. State it instead of implying it.

## Step 8 — Close on the whole

Exactly one sentence: balance, palette, style, mood. Do not summarise a second time.

## Length

Follow what the image carries:

- single subject: 250–350 words
- multi-region, poster with type, busy scene: 400–550 words

Every sentence must change the picture. If deleting it would not alter the render, delete it.

Hard caps by target model: Midjourney ≤120 words, compress to nouns; SD and SDXL prefer tag phrasing over paragraphs; Seedream, GPT Image and Flux take the full paragraph.

## Leave room

Specify: stated colours, counts, verbatim copy, what came from the reference, light direction and warmth, the large colour blocks, the one thing that makes this frame specific.

Leave open: exact facial subtlety, how cloth folds, rain density, how many strangers are in the far background, mid-tone gradients, fine ornament.

Never write: pixel sizes or coordinates, fontSize, resolution, the ratio inside the paragraph, camera kit, quality boosters — masterpiece, 8K, ultra-detailed, award-winning, hyper-realistic — and "do not show X" inside the prompt, because renderers tend to draw the thing named. Negations belong in the target's negative channel when it has one.

## Language

The paragraph is English, natural and literal, not a tag list. Text inside the image keeps its own script: Chinese stays Chinese, Japanese stays Japanese, copied exactly. No romanisation, no translation of on-image copy, no mixing languages for texture.

One exception, and only one: a reference label may keep its native form — "参考图一", "图一" — when the target model is Chinese-facing. Write "picture 1" for English-facing models. A label binds an image; it never replaces the trait list.

## Output

First block: the paragraph. Plain text, no heading, no fence, no quotation marks around it, no preamble.

Then one blank line, then at most two metadata lines:

```
ratio: 3:4
held: face, hair
```

`held` appears only when a reference image was read. Drop either line when it does not apply. Say once, briefly, after the block, that the paragraph is what gets pasted and the lines below it are notes.

Return nothing else. No explanation, no "here is your prompt", no offer to register three directions. If the user later asks for a variant, change only the named thing — light, palette, one element — and say in one clause what you changed.

## When the brief is thin

Resolve the ambiguity with visual decisions, not with narrative ones. "A woman at night" becomes a specific woman in a specific light at a specific distance — not a woman with a story, a letter, and a stray cat. If the frame needs a decision you cannot justify from the brief, make the least surprising choice and keep it small.

When the user's idea and the category conflict — a poster with no text, a product shot with no surface — follow the user, then name the tension in one line below the prompt.

## References

Load these when they apply. Skip them otherwise.

- `references/observing.md` — worked examples, sentence rhythm, how a good paragraph fails and why. Read before a first run.
- `references/categories.md` — the five categories: medium noun, frame strategy, text policy, length cap, traps.
- `references/reference-images.md` — layer locking, multi-image, leakage. Read whenever an image is attached.

## Check

When Node is available, validate the draft before returning it, from the skill directory:

```bash
node bin/prompt-director.mjs check --file draft.txt --category poster --copy "深夜营业"
```

Exit 0 passes, 1 means errors, 2 means bad usage. Fix errors by rewriting the sentence that caused them. Do not re-roll the whole paragraph, and never pad it to reach a word count.
