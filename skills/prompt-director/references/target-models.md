# Target models

The caption is the same craft in every case. What changes is how much of it the model parses, and in what shape.

Infer the target from what the user says ("for Midjourney", "I'm using Seedream", "SDXL"), from the deliverable (a poster with exact copy usually means an instruction or caption model), and from the platform they paste into. When nothing points anywhere, write the caption profile — it is the one that also reads correctly as a brief.

## caption profile

FLUX, Krea, Qwen-Image text-to-image, most open-weight checkpoints.

- **Shape**: a finished-frame description. Subject, materials, light, space, closing beat.
- **Verb**: present, declarative. Not "create", not "show", not "imagine".
- **Negations**: avoid inside the body. A caption model has no negative channel, and named absences get drawn.
- **Positives over absences**: "a deserted promenade" instead of "no people"; "monochrome" instead of "no colour".
- **Length**: 250–550 words. Looked-at frames 250–350. Density is set by reading mode, not by word target.
- **Signal**: concrete materials and one specific gesture. "A patched linen apron, dark at the hem" carries more than "a rustic apron".

## instruction profile

GPT Image 2.5, Seedream, Nano Banana, Qwen-Image-Edit.

- **Shape**: a brief. What the image is for, who it is for, how the frame is organised, the exact strings, then constraints.
- **Anchors**: it infers context from named real-world anchors — a place plus a date, a profession, an industry, a named product category. "A 1990s Harbin photo studio" does more than twenty period adjectives.
- **Negatives**: it honours them, so give each refusal once, at the end, and keep them few: no extra text, no watermark, no unrelated logos.
- **Counts**: explicit numbers work ("exactly once", "four cards in a single row").
- **Camera specifications**: cues to appearance, not physical guarantees. Keep them only if the user asks for a photographic look.
- **Length**: 80–250 words for a plain frame; a dense frame still gets a dense prompt. Shorter is allowed, empty is not.
- **Signal**: stated hierarchy. Say what dominates, what supports, what stays empty.

## tag profile

Midjourney, SD 1.5 / SDXL, NovelAI-style anime models.

- **Shape**: nouns and short clauses, comma separated, no sentences. Medium and style first.
- **Channel syntax**: weights, `--ar`, `--style`, quality tokens, emphasis brackets are the platform's own idiom and live on one short line outside the caption.
- **Negatives**: parameters only (`--no …`), never inside the body.
- **Length**: Midjourney ≤120 words; SD 1.5 ≤75 tokens of substance.
- **Signal**: concrete nouns and one style anchor beat adjectives. "impasto brushwork, olive canvas, wind-streaked fur" beats "beautiful detailed painting".

## Editing models

The three profiles above describe frames from nothing. Every model that accepts an image input also accepts an edit, and they parse deltas differently. The constant across all of them is the four moves — point, change, hold, values — and the lengths in `reference-images.md`.

**FLUX 3 (single reference).** Three parts: name the target until only one thing matches, say what it becomes, name what must stay. Hex values for colour (`#e01075`), quoted text with its placement and style, region named in words. Several changes in one prompt want an edit record with the preserve list written out element by element — "everything else unchanged" alone underperforms here. Box rows (`<ref_image_0>` plus an id and four values on a 0–1000 grid) for one-of-many targets, exact positions, moves and resizes, and single removals. Vague verbs fail: "fix the image" loses to "open the owl's eyes, making them look natural".

**GPT Image 2.5.** Separates the change from the constraints: "replace only X", then the details to preserve (identity, geometry, layout, light, labels), then a closing blanket. Labelled sections are legitimate for a complex pass — scene, subject, details, constraints — and the structure survives because it follows the input's own parts. References are assigned roles by number and described as roles, not as pictures. Iterate by feeding the accepted output back in, one change per pass; repeat character constraints each round, since drift is cumulative. If a region must be pixel-exact, composite rather than prompt.

**Seedream 4.0 / 5.0 Pro.** Generation and editing share one architecture, and the native prompt is a short imperative in the user's language — 「移除这张图片里的男生」「把灯打开，客厅亮起来，但从窗外仍然能看出是夜晚」「把"Santiago Music Festival"改成"Seedream Photography Exhibition"，文字的配色、字体、对齐方式都保持不变」. One sentence per intent. Multi-image work puts the composition in the same sentence ("多图输入，一句话组合"), so name each image's role and the arrangement in one clause. Do not restate the input's aesthetics — this family reads the picture and needs only the delta.

**Qwen-Image-Edit.** Short declarative English or Chinese: "Change the rabbit's color to purple, with a flash light background." Multi-image binds by named positions ("the magician bear is on the left, the alchemist bear is on the right"). The project ships a rewriting step (`polish_edit_prompt`, Qwen-VL-Max) and its own README warns that edits are unstable without it, so write the sentence that rewriting wants: target, new state, hold — not a paragraph of atmosphere. Text-to-image on this family does expect a positive phrase tail ("Ultra HD, 4K, cinematic composition"); that belongs on the scaffolding line, never in the caption body.

**Nano Banana.** Conversational and stateful. One change per turn, keep the thread, and re-anchor the invariants only when they visibly decay — a long prompt here reads as a request to redesign.

## The scaffolding line

For tag models only, the model's channel syntax may go on a single short line above the caption. It carries parameters and style tokens, never description, and it never substitutes for a complete caption.

- Keep it to what the platform actually parses. Twenty quality tokens buy nothing.
- Never put quality tokens into the caption body of any profile. Masterpiece, 8K, ultra-detailed, best quality, hyper-realistic, award-winning, trending: none of them produce pixels.
- The caption below the line must stand alone. If someone deletes the line, the picture should still be describable from the paragraph.

## Mixed targets

A caption written for FLUX gets pasted into Midjourney: cut to short clauses, keep the structure, drop the sentences. A Midjourney prompt gets pasted into GPT Image: keep the nouns, add the brief's hierarchy and the strings. Say in one clause that you converted it, and what you dropped.

## What the collected library shows

Reading a batch of prompts people actually saved and reused, three shapes recur, and each maps to a profile.

- **Tag preamble + prose paragraph** (anime checkpoints): quality tokens, weight brackets, then a natural-language scene. The prose carries the frame; the preamble carries the channel. Copy the prose. Copy the preamble only when the platform parses it, and keep the two layers visibly separate.
- **Pure long paragraph** (photographic and painterly styles): medium first, body detail, setting, then a finish clause listing tangible artefacts — digital grain, blown highlights, JPEG compression, ink bleeding into cardboard, impasto ridges. This is the caption profile at its best, and the finish clause is the part most people leave out.
- **Labelled blocks** (`outfit:`, `palette:`, `scene/background:`, `pose:`, `camera:`): a user habit, not a model requirement. Useful when the user wants to iterate field by field; convert it into one paragraph when the target reads prose, and keep the field names out of the body.

Common defects in the same library: a sentence duplicated verbatim, a multi-character scene written as a comma run with no positions, a negative appended as the last clause, and the ratio or camera kit embedded in the prose.
