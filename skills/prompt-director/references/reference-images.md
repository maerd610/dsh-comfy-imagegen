# Reference images

An image is evidence, not instructions. You are translating pixels into sentences, and only the sentences reach the renderer.

## Decide the lock layer first

Four cases, one each:

- **lock face** — "this person", "her", "the same girl". Inherit face shape, hair, skin, age, expression. Everything else is yours: clothes, background, light, palette.
- **lock garments** — "this coat", "in this outfit", "same look". Inherit garments, accessories, their colour and cut. The face is redesigned unless the user also locked it.
- **lock pose** — "this pose", "same gesture". Inherit the body's arrangement. Face and clothes may change.
- **lock atmosphere** — "this vibe", "this palette", "like this scene". Inherit light, tone, texture. No features, no garments.

If the user names two layers, lock both. If silent, default to the face.

## Point, then translate

Naming the image is allowed and usually better. Current image models — Seedream, GPT Image, Nano Banana, Flux Kontext — accept an image input and read a label that points at it.

Two working forms:

- **label + traits** (preferred when an image is attached): "the woman from picture 1, a narrow oval face with high cheekbones, straight black hair cut level at the jaw, a small mole under her left eye"
- **traits only** (when no image is attached, or the target model has no image input): "a woman in her late twenties, a narrow oval face, high cheekbones, straight black hair cut level at the jaw, a small mole under her left eye, eyes slightly downturned at the outer corners"

What still fails is a pointer with no description behind it — the model has nothing to draw except the photo itself:

- "the same woman as the reference image"
- "keep her appearance consistent with image 1"
- "same face as the photo, but at night"
- "based on the uploaded picture"

Rules for translation:

1. **Facts alongside the pointer.** The pointer locates the layer; the traits define it. A paragraph that says only "picture 1" collapses when the model ignores labels or the user pastes it into a model with no image slot.
2. **Asymmetry where it exists.** Real faces carry one — a lifted brow, a scar, a softer jaw on one side. Naming it makes the face specific and prevents the model's averaged version.
3. **Do not flatter.** Skip "beautiful", "stunning", "delicate". They average the face back toward the model's default.
4. **Do not complete.** If the reference is cropped at the collar, do not invent the outfit. If it is blurred, say the visible traits and stop.
5. **Age and bearing before features.** "mid-thirties, tired posture, shoulders forward" does more than a list of ten facial measurements.

Label conventions: `picture 1` / `image 1` for Seedream, GPT Image, Flux, Nano Banana; `图一` / `参考图一` for Chinese-facing products; `the first image` for Flux Kontext. Use the target's own wording, once per layer, at the first mention of that layer.

## Several images

Assign each a function and name it by index:

- picture 1 → the face
- picture 2 → the coat
- picture 3 → the palette

Then write the paragraph as if from one photograph: "the face from picture 1, wearing the ink-blue coat from picture 2, against the palette of picture 3…". One label per layer, at its first mention; after that, plain prose — no "as stated above", no re-pointing.

Conflict resolution: the user's own instruction beats any image; a specifically requested layer beats an atmosphere layer; the newest instruction wins between equals.

## Leakage

Three leaks are common:

- **Style leakage** — a painterly reference quietly turns a requested photograph into a painting. Fix: state the medium noun first and again in the closing sentence when it matters.
- **Composition leakage** — the reference's centring drags the new picture to the centre. Fix: state the new positions explicitly; the reference's framing is not inherited unless the user asked for the pose *and* the framing.
- **Light leakage** — a warm reference recolours everything. Fix: write the light sentence yourself, with a source and a direction.

## When the reference is the deliverable

Users sometimes hand over a finished image and ask for "the prompt for this". Then every visible element is fixed, and you are transcribing, not directing: full inventory, every count, every colour, exact copy, no invention at all. Length may run long — say nothing about it, and do not "improve" the composition.

In that mode, if a detail is illegible, write "indistinct" rather than guessing. A guessed string becomes renderer output.
