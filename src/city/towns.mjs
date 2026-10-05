// agentropolis/city — starter towns
//
// Each town teaches one idea about agent systems, and each is a complete,
// runnable city file. They double as the "preset packs": pick one, change a
// job description, and it is yours.

const person = (p, emoji, color) => ({ person: p, emoji, color });

export const TOWNS = [
  {
    agentropolis: 'city/1',
    name: 'Homework Helper',
    emoji: '🎒',
    lesson: 'Handoffs: one worker\'s answer becomes the next worker\'s mail.',
    description: 'A researcher looks the topic up, then an explainer turns the facts into something a 12-year-old would enjoy reading.',
    example: 'Why is the sky blue?',
    agents: [
      {
        name: 'researcher', role: 'Researcher',
        description: 'Finds the real facts before anyone writes a word.',
        system_prompt:
          'You are a careful researcher. Use the wikipedia_search tool to look up the topic you are given — ' +
          'do not rely on memory. Then reply with the 3 to 5 most important facts, in plain sentences, ' +
          'and nothing else. If Wikipedia does not cover it, say so.',
        tools: ['wikipedia_search'],
        city: person('Rosa', '🔎', '#7c5cff'),
      },
      {
        name: 'explainer', role: 'Explainer',
        description: 'Turns facts into a short, friendly explanation.',
        system_prompt:
          'You explain things to a curious 12-year-old. You will receive research notes. Write a short, ' +
          'friendly explanation (under 150 words) using only those notes. Use one everyday comparison. ' +
          'Do not add facts that are not in the notes.',
        tools: [],
        city: person('Theo', '🧑‍🏫', '#ff8a3d'),
      },
    ],
    workflow: { name: 'homework-helper', type: 'sequential', agents: ['researcher', 'explainer'] },
    safety: { approve_before: [], inspector: true },
  },

  {
    agentropolis: 'city/1',
    name: 'Trip Planner',
    emoji: '🧳',
    lesson: 'Tools: workers run real errands — the forecast, the encyclopedia and the calculator are live.',
    description: 'Four specialists each handle one part of a trip, and a planner puts their notes together.',
    example: 'Plan a weekend in Lisbon. Our budget: hotel 2 * 95 plus food 3 * 40 euros.',
    agents: [
      {
        name: 'weather-watcher', role: 'Weather Watcher',
        description: 'Checks the real forecast for the destination.',
        system_prompt:
          'You check the weather. Use the weather tool for the destination named in the request. ' +
          'Reply with the forecast in two or three plain sentences, plus one packing tip.',
        tools: ['weather'],
        city: person('Wren', '🌦️', '#3fa7d6'),
      },
      {
        name: 'local-guide', role: 'Local Guide',
        description: 'Finds what is worth seeing.',
        system_prompt:
          'You are a local guide. First call the wikipedia_search tool with the name of the destination — ' +
          'never ask the traveller questions. Then reply with three things worth seeing or doing there, one line each.',
        tools: ['wikipedia_search'],
        city: person('Gus', '🗺️', '#2fbf71'),
      },
      {
        name: 'budget-keeper', role: 'Budget Keeper',
        description: 'Adds up the money exactly.',
        system_prompt:
          'You keep the budget. Call the calculator tool for the sums written in the request (for example ' +
          '"2 * 95 + 3 * 40") — never do math in your head and never ask questions. When the result comes ' +
          'back, reply with each cost and the total.',
        tools: ['calculator'],
        city: person('Bea', '💰', '#d6a33f'),
      },
      {
        name: 'trip-writer', role: 'Trip Writer',
        description: 'Combines everyone\'s notes into one plan.',
        system_prompt:
          'You write the final trip plan. Combine the forecast, the guide\'s ideas and the budget you are ' +
          'given into a short day-by-day plan. Only use information from the notes. If a note is missing, ' +
          'plan without it — never ask questions.',
        tools: [],
        city: person('Pia', '✍️', '#e0559b'),
      },
    ],
    workflow: {
      name: 'trip-planner', type: 'sequential',
      steps: [
        { agent: 'weather-watcher', input: '$INPUT', output: 'forecast' },
        { agent: 'local-guide', input: '$INPUT', output: 'sights' },
        { agent: 'budget-keeper', input: '$INPUT', output: 'budget' },
        {
          agent: 'trip-writer',
          input: 'Request: {{INPUT}}\n\nWeather notes:\n{{forecast}}\n\nGuide notes:\n{{sights}}\n\nBudget notes:\n{{budget}}',
          output: 'plan',
        },
      ],
    },
    safety: { approve_before: [], inspector: false },
  },

  {
    agentropolis: 'city/1',
    name: 'Second Opinions',
    emoji: '🔀',
    lesson: 'Parallel work: the same letter goes to everyone at once, and every answer comes back.',
    description: 'Three advisors with different personalities answer the same question side by side.',
    example: 'Should I learn to play the guitar at 40?',
    agents: [
      {
        name: 'optimist', role: 'Optimist',
        description: 'Looks for what could go right.',
        system_prompt: 'You are an encouraging optimist. Give the strongest honest case FOR the idea in three sentences.',
        tools: [],
        city: person('Olive', '🌞', '#f2b600'),
      },
      {
        name: 'skeptic', role: 'Skeptic',
        description: 'Looks for what could go wrong.',
        system_prompt: 'You are a fair skeptic. Give the strongest honest case AGAINST the idea, or its biggest risks, in three sentences.',
        tools: [],
        city: person('Sid', '🧐', '#6c7a89'),
      },
      {
        name: 'practical', role: 'Practical Planner',
        description: 'Turns it into a first step.',
        system_prompt: 'You are practical. Ignore whether it is a good idea; say the very first concrete step and what it costs in time and money, in three sentences.',
        tools: [],
        city: person('Penny', '🛠️', '#2fbf71'),
      },
    ],
    workflow: { name: 'second-opinions', type: 'parallel', parallel: { agents: ['optimist', 'skeptic', 'practical'] } },
    safety: { approve_before: [], inspector: false },
  },

  {
    agentropolis: 'city/1',
    name: 'Town Meeting',
    emoji: '🗣️',
    lesson: 'Conversation: workers meet in the plaza and each one hears everything said before them.',
    description: 'A dreamer, a critic and a mediator talk it through until they agree or run out of rounds.',
    example: 'Our school wants to switch to a four-day week. Good idea?',
    agents: [
      {
        name: 'dreamer', role: 'Dreamer',
        description: 'Pitches bold ideas.',
        system_prompt: 'You are the dreamer at a town meeting. Reply in two sentences: build on the discussion with a bold, hopeful idea.',
        tools: [],
        city: person('Dana', '💭', '#9b6bff'),
      },
      {
        name: 'critic', role: 'Critic',
        description: 'Points out problems, kindly.',
        system_prompt: 'You are the critic at a town meeting. Reply in two sentences: name the most important problem with what was just said, kindly.',
        tools: [],
        city: person('Cal', '🧐', '#e5484d'),
      },
      {
        name: 'mediator', role: 'Mediator',
        description: 'Finds the middle ground.',
        system_prompt:
          'You are the mediator at a town meeting. Reply in two sentences proposing a middle ground both ' +
          'sides could accept. If the group has reached a sensible compromise, start your reply with AGREED.',
        tools: [],
        city: person('Max', '🤝', '#2fbf71'),
      },
    ],
    workflow: {
      name: 'town-meeting', type: 'conversation',
      agents: ['dreamer', 'critic', 'mediator'],
      conversation: { maxRounds: 2, stopWhen: 'output.startsWith("AGREED")' },
    },
    safety: { approve_before: [], inspector: false },
  },

  {
    agentropolis: 'city/1',
    name: 'Writing Studio',
    emoji: '🔁',
    lesson: 'Loops and approval: the editor can send work back, and nothing is published without your stamp.',
    description: 'A writer drafts, an editor approves or sends it back, and a publisher polishes the approved version — after the Mayor signs off.',
    example: 'A four-line poem about autumn for a birthday card.',
    agents: [
      {
        name: 'writer', role: 'Writer',
        description: 'Writes and revises drafts.',
        system_prompt:
          'You are a writer. Write what the assignment asks for. If the editor left notes on your last ' +
          'draft, revise that draft to address every note. Reply with the draft only.',
        tools: [],
        city: person('Wendy', '✍️', '#ff8a3d'),
      },
      {
        name: 'editor', role: 'Editor',
        description: 'Approves good work, sends weak work back.',
        system_prompt:
          'You are a demanding but fair editor. If the draft fully meets the assignment, reply with the ' +
          'single word APPROVED followed by one sentence of praise. Otherwise reply with two or three ' +
          'specific notes for the writer, and do not use the word approved.',
        tools: [],
        city: person('Ed', '🧐', '#5b6ee1'),
      },
      {
        name: 'publisher', role: 'Publisher',
        description: 'Formats the final version.',
        system_prompt: 'You are the publisher. Reply with a short title on the first line, then the approved draft exactly as written. Never leave the draft out, and do not change its wording.',
        tools: [],
        city: person('Pat', '🖨️', '#2fbf71'),
      },
    ],
    workflow: {
      name: 'writing-studio', type: 'graph',
      graph: {
        entry: 'draft', maxSteps: 9,
        steps: [
          {
            id: 'draft', agent: 'writer', output: 'draft', next: 'review',
            input: 'Assignment: {{INPUT}}\n\nEditor\'s notes on your last draft: {{review_notes}}\n\nYour last draft: {{draft}}',
          },
          {
            id: 'review', agent: 'editor', output: 'review_notes',
            input: 'Assignment: {{INPUT}}\n\nDraft to review:\n{{draft}}',
            condition: { if: 'output.includes("APPROVED")', then: 'publish', else: 'draft' },
          },
          { id: 'publish', agent: 'publisher', input: '{{draft}}', output: 'final', next: 'END' },
        ],
      },
    },
    state: { review_notes: '(none yet — this is the first draft)', draft: '(none yet)' },
    safety: { approve_before: ['publisher'], inspector: false },
  },

  {
    agentropolis: 'city/1',
    name: 'Math Tutor',
    emoji: '🧮',
    lesson: 'Why tools matter: language models guess at math, a calculator does not.',
    description: 'One tutor who always uses the Counting House for arithmetic and explains each step.',
    example: 'What is 35 * 18 - 120? Explain it like a story.',
    agents: [
      {
        name: 'tutor', role: 'Math Tutor',
        description: 'Explains math step by step and never guesses.',
        system_prompt:
          'You are a patient math tutor. Use the calculator tool for every calculation, even easy ones. ' +
          'Then explain the steps simply and finish with "Answer: <value>".',
        tools: ['calculator'],
        max_tool_iterations: 5,
        city: person('Ann', '🧮', '#d6a33f'),
      },
    ],
    workflow: { name: 'math-tutor', type: 'sequential', agents: ['tutor'] },
    safety: { approve_before: [], inspector: false },
  },

  {
    agentropolis: 'city/1',
    name: 'Memory Keeper',
    emoji: '🗄️',
    lesson: 'Memory: a worker forgets everything between jobs unless it files notes in the Records Office.',
    description: 'An archivist who writes things down and looks them up later — even after you close the page.',
    example: 'Remember that my dentist appointment is on Friday at 3pm.',
    agents: [
      {
        name: 'archivist', role: 'Archivist',
        description: 'Files notes away and finds them again.',
        system_prompt:
          'You are an archivist. When asked to remember something, save it with the remember tool under a ' +
          'short topic. When asked what you remember, use the recall tool first. Never claim to remember ' +
          'something you did not look up.',
        tools: ['remember', 'recall', 'clock'],
        city: person('Archie', '🗄️', '#6b8f71'),
      },
    ],
    workflow: { name: 'memory-keeper', type: 'sequential', agents: ['archivist'] },
    safety: { approve_before: [], inspector: false },
  },
];

export function townByName(name) {
  const t = TOWNS.find((x) => x.name.toLowerCase() === String(name).toLowerCase());
  return t ? structuredClone(t) : null;
}
