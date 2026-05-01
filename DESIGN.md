---
name: German Conjunctions Trainer
colors:
  primary: "#d86424"
  on-primary: "#fff8f0"
  primary-container: "#ef8639"
  on-primary-container: "#43281b"
  secondary: "#a33f11"
  on-secondary: "#fff8f0"
  surface: "#fff8ef"
  surface-dim: "#fff2df"
  surface-bright: "#fffaf4"
  surface-container: "#ffe5c2"
  on-surface: "#43281b"
  on-surface-variant: "#7a5a47"
  background: "#fffaf4"
  on-background: "#43281b"
  outline: "rgba(163, 63, 17, 0.2)"
  success: "#2f9f59"
  error: "#d84d3e"
  focus: "rgba(239, 134, 57, 0.35)"
typography:
  display:
    fontFamily: "Nunito Sans"
    fontSize: "1.875rem"
    fontWeight: "700"
  headline-lg:
    fontFamily: "Nunito Sans"
    fontSize: "1.5rem"
    fontWeight: "700"
  title-md:
    fontFamily: "Nunito Sans"
    fontSize: "1.125rem"
    fontWeight: "600"
  body-lg:
    fontFamily: "Nunito Sans"
    fontSize: "1rem"
    fontWeight: "400"
  body-md:
    fontFamily: "Nunito Sans"
    fontSize: "0.875rem"
    fontWeight: "400"
  label-md:
    fontFamily: "Nunito Sans"
    fontSize: "0.875rem"
    fontWeight: "600"
rounded:
  sm: "0.375rem"
  md: "0.5rem"
  lg: "0.75rem"
  full: "9999px"
spacing:
  "1": "0.25rem"
  "2": "0.5rem"
  "3": "0.75rem"
  "4": "1rem"
  "6": "1.5rem"
  "8": "2rem"
components:
  card:
    backgroundColor: "rgba(255, 252, 247, 0.88)"
    rounded: "{rounded.md}"
    border: "1px solid rgba(255, 255, 255, 0.65)"
  button-primary:
    background: "linear-gradient(145deg, {colors.secondary} 0%, {colors.primary} 58%, {colors.primary-container} 100%)"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.md}"
    padding: "{spacing.2} {spacing.4}"
  button-secondary:
    background: "linear-gradient(145deg, #fff9f0 0%, #ffeacc 100%)"
    textColor: "{colors.secondary}"
    rounded: "{rounded.md}"
    padding: "{spacing.2} {spacing.4}"
    border: "1px solid {colors.outline}"
---

## Brand & Style

The German Conjunctions Trainer uses a warm, engaging, and approachable design tailored for educational tools. The color scheme is predominantly built on a spectrum of soft cream and vibrant orange, reflecting energy, focus, and clarity.

The aesthetic leverages soft "glassmorphism" details—such as slightly transparent, frosted-glass components resting over a dynamic, subtly animated, breathing gradient background. This provides a deep sense of immersion without adding distracting visual clutter.

## Colors

The color palette centers on a dynamic range of Oranges and Creams.

- **Primary Canvas:** The background features a slowly breathing multi-layered radial and linear gradient of creams (`#fffaf4`, `#ffeed6`, `#ffe3bf`) intersected with soft translucent orange flares (`rgba(239, 134, 57, 0.22)`).
- **Primary & Secondary:** A rich, vibrant orange palette (`#d86424`, `#a33f11`, `#ef8639`) is used for active components like buttons, highlights, and progress bars. This drives engagement and clearly signals interactivity.
- **Surfaces:** Main content containers, cards, and text inputs utilize frosted, soft creams with varying transparencies (`rgba(255, 252, 247, 0.88)`). This provides high contrast for the text while staying harmonized with the background.
- **Text:** To avoid the harshness of pure black, all typographic elements use a deep, warm espresso tone (`#43281b`), with a softer muted tone (`#7a5a47`) for secondary labels and hints.

## Typography

The design system uses **Nunito Sans** as its foundational typeface. Nunito Sans provides a friendly, well-rounded geometric structure that is highly legible, making it perfect for an educational application where clarity of foreign vocabulary is paramount.

- **Hierarchy:** Font weights heavily define the structural hierarchy, with bold (`700`) used for primary headers, semi-bold (`600`) for buttons and sub-headers, and regular (`400`) for standard body copy.
- **Application:** Type is set with generous line heights to minimize reading fatigue.

## Layout & Spacing

A fluid, centralized layout acts to keep the student's focus entirely on the learning materials.

- **Containerization:** The main content is contained within a centralized `max-w-3xl` (48rem) wrapper, providing a comfortable reading measure for sentences and grammar rules.
- **Spacing Scale:** A strict rem-based spacing scale guarantees consistent rhythm. We rely heavily on generous internal padding (`spacing.6` and `spacing.8`) within cards to create a calm, uncluttered experience.
- **Structure:** Key elements like the header span full-width with a dynamic blurred backdrop to anchor the navigation, while the actual exercises float centrally.

## Elevation & Depth

Elevation is established using a combination of layered opacity, backdrop blurs, and soft, warm-toned drop shadows.

- **Shadows:** Unlike typical neutral gray drop shadows, this system uses a warm tinted shadow (`rgba(105, 45, 18, 0.22)`). This ensures the shadows feel like natural lighting rather than dark, muddy silhouettes.
- **Gradients and Borders:** Buttons employ a subtle `145deg` linear gradient combined with very soft, semi-transparent white top borders to simulate a 3D bevel or lighting effect.
- **Glass Effects:** Cards and modems heavily feature `backdrop-filter: blur(18px)` and semi-transparent backgrounds to sit softly on the vibrant animated page background.

## Shapes

Shapes are inherently friendly and soft, avoiding harsh 90-degree angles.

- **Standard Elements:** Cards, containers, inputs, and the majority of buttons use a medium (`0.5rem`) or large (`0.75rem`) border radius.
- **Word Chips:** Scrambled word components use a tighter, tactile rounded structure (`0.375rem`) to feel like physical, grabbable tiles.
- **Full Rounded:** Progress tracks, filter badges, and loading spinners use fully rounded (`9999px`) pill structures to add contrast against the rectangular content cards.

## Components

### Buttons
Buttons are highly tactile. Primary buttons use a rich multi-stop orange gradient with a warm shadow and a slight upward shift on hover. Secondary buttons provide a quieter alternative with cream gradients and delicate, warm outlines. Interactive states are responsive, utilizing a custom focus ring (`rgba(239, 134, 57, 0.35)`) to maintain accessibility.

### Cards & Exercise Containers
The primary interaction area is the `card` component, which acts as a frosted glass slate holding the current exercise. The main answer drop zone uses an inset gradient and a subtle border to create a "recessed" well, inviting the user to place word tiles into it.

### Scrambled Word Tiles
Word tiles (`btn-word`) act like small, physical game pieces. They have an opaque cream background, a subtle border, and a shadow that lifts significantly on hover. They frequently feature tiny numeric hotkey indicators to support rapid keyboard navigation.

### Progress and State
The progress bar utilizes a distinct shimmer effect (a moving translucent white gradient over the orange fill) to make the learning journey feel rewarding and dynamic. Completion states use friendly, brightly colored semantic pills (e.g., green for success, blue for hints used) to provide immediate, non-punishing feedback.