// LEP: Lilith Event Paradox v0.6 Context: run last. Console cycles receive only a neutral
// control prompt; ordinary cycles keep bounded memory and remove known controls.
// EP memory, optional Inner Self context, then one opt-in EP Auto-Cards task.
const modifier = (text) => {
  return { text: EP_context(text) };
};
modifier(text);
