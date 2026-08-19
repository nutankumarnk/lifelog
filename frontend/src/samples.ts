/**
 * Sample conversations, one per behaviour worth checking by hand.
 *
 * These mirror the scenarios in docs/testing.md so a reviewer can reproduce
 * what the automated suite asserts, without reading the test file.
 */

export interface Sample {
  label: string;
  hint: string;
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    label: 'Memory',
    hint: 'A past event plus the people and places that make it a memory',
    text: 'I met Arun yesterday in Ahmedabad. We had chai near the riverfront and talked for hours.',
  },
  {
    label: 'Task',
    hint: 'An obligation — should not become a reminder',
    text: 'I need to call the bank tomorrow about the loan paperwork.',
  },
  {
    label: 'Reminder',
    hint: 'An explicit request to be prompted, with a resolved date',
    text: 'Remind me to call the dentist next Monday.',
  },
  {
    label: 'Reminder, no time',
    hint: 'Triggers the one follow-up question Lifelog will ask',
    text: 'Remind me to submit the insurance form.',
  },
  {
    label: 'Mixed',
    hint: 'One message, several item types and several dates',
    text: 'I met Arun yesterday in Ahmedabad and I need to send him the project files by Friday. I felt relieved afterwards.',
  },
  {
    label: 'Diary',
    hint: 'Reflection — Lifelog records it and stays quiet',
    text: 'Today I visited the Sabarmati Ashram with Priya. It was peaceful and I felt calm for the first time in weeks.',
  },
  {
    label: 'Plan',
    hint: 'A future event with a resolved date',
    text: "I'm flying to Delhi next Friday for my cousin's wedding.",
  },
  {
    label: 'Decision',
    hint: 'A choice the user has made',
    text: 'I decided to switch from Notion to Obsidian for my notes.',
  },
  {
    label: 'Unknown entity',
    hint: 'A thing Lifelog cannot categorise is kept, not dropped',
    text: 'I bought a new Kelong stove for the trek next month.',
  },
  {
    label: 'Mixed language',
    hint: 'Hinglish — "kal" is ambiguous, so no date is guessed',
    text: 'Kal mujhe Arun se milna hai, and I need to book the tickets.',
  },
  {
    label: 'Multiple dates',
    hint: 'Each date resolves independently',
    text: 'I saw the doctor yesterday and I have to collect the report next Tuesday.',
  },
  {
    label: 'Nothing to extract',
    hint: 'An empty result is a correct answer',
    text: 'ok',
  },
];
