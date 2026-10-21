// LEP: Lilith Event Paradox v0.6 Input: capture whole-action /ep controls before other
// scripts can interpret them. The returned control placeholder is nonempty.
// Ordinary inputs rescan entities, then run optional bundled Inner Self.
// Install Library too. Keep only ONE modifier when composing scripts.
const modifier = (text) => {
  return { text: EP_input(text) };
};
modifier(text);
