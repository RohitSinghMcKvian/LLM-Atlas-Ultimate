import type { Variants, Transition } from "framer-motion";

/** Signature easing for the whole product — confident, settled. */
export const EASE = [0.16, 1, 0.3, 1] as const;
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const springSoft: Transition = {
  type: "spring",
  stiffness: 320,
  damping: 30,
  mass: 0.8,
};

export const springSnappy: Transition = {
  type: "spring",
  stiffness: 520,
  damping: 34,
};

/** Container that staggers its children's reveal. */
export const staggerContainer = (stagger = 0.06, delay = 0): Variants => ({
  hidden: {},
  show: {
    transition: { staggerChildren: stagger, delayChildren: delay },
  },
});

/** Item that fades + rises into place. */
export const fadeUp = (y = 16, duration = 0.6): Variants => ({
  hidden: { opacity: 0, y },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration, ease: EASE },
  },
});

export const fadeIn = (duration = 0.5): Variants => ({
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration, ease: EASE } },
});

export const scaleIn = (duration = 0.5): Variants => ({
  hidden: { opacity: 0, scale: 0.96 },
  show: { opacity: 1, scale: 1, transition: { duration, ease: EASE } },
});

/** For route transitions. */
export const pageTransition: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.35, ease: EASE } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2, ease: EASE } },
};
