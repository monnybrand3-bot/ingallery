---
name: InGallery
colors:
  surface: '#121414'
  surface-dim: '#121414'
  surface-bright: '#37393a'
  surface-container-lowest: '#0c0f0f'
  surface-container-low: '#1a1c1c'
  surface-container: '#1e2020'
  surface-container-high: '#282a2b'
  surface-container-highest: '#333535'
  on-surface: '#e2e2e2'
  on-surface-variant: '#c4c7c7'
  inverse-surface: '#e2e2e2'
  inverse-on-surface: '#2f3131'
  outline: '#8e9192'
  outline-variant: '#444748'
  surface-tint: '#c8c6c5'
  primary: '#c8c6c5'
  on-primary: '#313030'
  primary-container: '#121212'
  on-primary-container: '#7e7d7d'
  inverse-primary: '#5f5e5e'
  secondary: '#e9c349'
  on-secondary: '#3c2f00'
  secondary-container: '#af8d11'
  on-secondary-container: '#342800'
  tertiary: '#4edea3'
  on-tertiary: '#003824'
  tertiary-container: '#00160c'
  on-tertiary-container: '#008f62'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#e5e2e1'
  primary-fixed-dim: '#c8c6c5'
  on-primary-fixed: '#1c1b1b'
  on-primary-fixed-variant: '#474646'
  secondary-fixed: '#ffe088'
  secondary-fixed-dim: '#e9c349'
  on-secondary-fixed: '#241a00'
  on-secondary-fixed-variant: '#574500'
  tertiary-fixed: '#6ffbbe'
  tertiary-fixed-dim: '#4edea3'
  on-tertiary-fixed: '#002113'
  on-tertiary-fixed-variant: '#005236'
  background: '#121414'
  on-background: '#e2e2e2'
  surface-variant: '#333535'
typography:
  display-lg:
    fontFamily: Playfair Display
    fontSize: 64px
    fontWeight: '700'
    lineHeight: 72px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Playfair Display
    fontSize: 40px
    fontWeight: '600'
    lineHeight: 48px
  headline-md:
    fontFamily: Playfair Display
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-sm:
    fontFamily: Playfair Display
    fontSize: 24px
    fontWeight: '500'
    lineHeight: 32px
  body-lg:
    fontFamily: Inter
    fontSize: 18px
    fontWeight: '400'
    lineHeight: 28px
  body-md:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.1em
  headline-lg-mobile:
    fontFamily: Playfair Display
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  container-max: 1440px
  gutter: 24px
  margin-desktop: 64px
  margin-mobile: 20px
  section-gap: 120px
  element-gap: 16px
---

## Brand & Style
The design system is anchored in a **Premium Minimalist** aesthetic, specifically engineered to act as a sophisticated frame for high-end photography. The brand personality is professional, secure, and exclusive, evoking the feeling of a private gallery opening.

The style utilizes high-contrast transitions, generous whitespace (negative space), and subtle glassmorphism to create a sense of physical depth without distracting from the visual content. By prioritizing "content over container," the UI recedes to the background, ensuring that the user's photography remains the undisputed focal point of the experience.

## Colors
The palette is strictly dark-mode first to minimize screen glare and maximize the perceived vibrancy of displayed photographs.

- **Primary & Background:** Deep Charcoal (#121212) and Pure Black (#000000) are used to create infinite depth. Black is reserved for the main canvas, while Charcoal defines UI surfaces.
- **Accent (Gold/Champagne):** Used sparingly for premium touchpoints, such as primary action highlights, "Pro" tier badges, or active states in navigation.
- **Success (Green):** Specifically reserved for transactional states, unlocked galleries, and "paid" status indicators.
- **Neutral:** Crisp White (#FFFFFF) is used for maximum legibility of text and iconography against the dark backdrop.

## Typography
The typography strategy pairings high-contrast editorial elegance with functional utility.

- **Headlines:** Use **Playfair Display**. Its high-contrast serifs provide a literary, upscale feel. Large display sizes should use tighter letter spacing, while smaller headings should remain airy.
- **Body & UI:** Use **Inter**. This provides a neutral, highly legible contrast to the decorative nature of the headlines.
- **Labels:** Button text and small labels should utilize uppercase Inter with increased letter-spacing (0.05em to 0.1em) to reinforce the premium, "boutique" feel of the interface.

## Layout & Spacing
The layout follows a **Fluid Grid** model with extremely generous margins to mimic the mounting of a physical photograph in a gallery frame.

- **Desktop:** 12-column grid with 64px outer margins. Large-scale section gaps (120px) are used to separate different photography sets or platform features.
- **Mobile:** 4-column grid with 20px margins. Content should occupy the full width where possible to prioritize the visual impact on smaller screens.
- **Rhythm:** Spacing should be used to create hierarchy. More whitespace around an image signifies higher importance.

## Elevation & Depth
Elevation is achieved through **Glassmorphism** and **Tonal Layering** rather than traditional drop shadows.

- **Surfaces:** Use backdrop blurs (20px - 30px) on semi-transparent charcoal containers (#121212 at 80% opacity) for navigation bars and overlays.
- **Outlines:** Use thin, low-contrast borders (1px solid #FFFFFF at 10% opacity) to define edges without creating visual clutter.
- **Depth:** When an element is "raised" (e.g., a modal), it should not use a shadow; instead, the background behind it should significantly dim (darken), and the modal should feature a subtle inner glow or a slightly lighter border to catch the "light."

## Shapes
The design system uses a **Soft (0.25rem)** roundedness approach. While pure sharp corners feel too aggressive/brutal, high roundedness feels too casual/social. The subtle 4px radius provides a modern, precision-engineered feel that complements the thin borders and high-contrast typography. 

- **Media:** Images should maintain sharp corners (0px) to preserve the photographer's intended framing.
- **UI Elements:** Buttons, inputs, and containers follow the soft 4px rule.

## Components
- **Buttons:** Primary buttons use a solid Gold (#D4AF37) background with black text, no border. Secondary buttons use a transparent background with a 1px white border. All buttons feature 1px letter spacing and a "grow" hover transition.
- **Input Fields:** Minimalist style with only a bottom border (1px white @ 20%). On focus, the border color shifts to Gold.
- **Chips/Badges:** Used for metadata (ISO, Aperture, etc.). Small, semi-transparent backgrounds with white text in `label-sm` style.
- **Cards:** Photography cards should be borderless. Text information (Title, Date) should appear only on hover using a smooth fade-in overlay with a subtle backdrop blur.
- **Progress Indicators:** Use the Success Green (#10B981) for upload bars and payment processing to provide a psychological "reward" to the user.