# tokount design decisions

## Foundation

- Emotional register: **revealing, energized, trustworthy**. Never corporate, surveillance-like, or apologetic.
- User journey: a developer discovers the command, checks the privacy promise, runs it, receives a personal story, and shares a stable handle.
- First-class entities: the landing page (`/tokount`) and a person’s story (`/tokount/:handle`). Both deserve routes because both are shareable destinations.
- Actions: copying the command is immediate and acknowledged inline; opening the demo is navigation; publishing happens in the CLI with a specific success URL or actionable error.
- Spatial system: 4 px base; 96–160 px between sections, 40–72 px within section groups, 16–28 px inside controls, 4–12 px for tight labels. Comfortable density.
- Treatments: flat color fields separate story chapters. Borders describe controls or peer rows. No page-as-card treatment and no decorative card stripes.
- Color: ink and cream carry trust/readability; lime is the command/action signal; violet, pink, sun, and magma mark expressive story chapters. All text pairs meet AA at their rendered sizes.
- Type: Bricolage Grotesque for emotional headlines; JetBrains Mono for commands, metadata, and privacy details.

## Element contracts

- Copy Command is a button because it changes clipboard state. It confirms with “Command Copied”.
- Demo and brand destinations are links because they navigate.
- The command line is code, not a fake input. The handle is intentionally edited in the developer’s own terminal.
- The three process explanations are equal full-width bands, not cards; their relationship is a sequence of peers.

## Page system

- Full-width layout, LTR, expressive motion with a reduced-motion fallback.
- The landing page hierarchy is hero → runnable command → three-step journey → live demo → privacy promise → final command.
- Mobile reflows the three-step sequence into stacked full-width bands; navigation collapses to the brand mark because the command remains the primary path.

## Voice and motion

- Voice is direct, compact, and a little provocative. It says exactly what leaves the machine and what does not.
- Motion is organic and expressive in the hero and story, restrained around privacy and ownership. No motion is required to understand or operate the page.

## Self-review

- Buttons use verb + noun labels.
- No buttons perform navigation and no links mutate state.
- No standalone card containers.
- Keyboard focus is visible; reduced motion is supported; landmarks and headings are semantic.
- Existing handles cannot be overwritten. Pages expire after 30 days, while ownership remains reserved.
