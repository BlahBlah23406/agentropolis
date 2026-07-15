// Agentropolis City Builder — end-to-end demo with a custom city.json.
//   node demo-city.mjs
import { loadCity } from './src/cityLoader.js';
import { createCity, issueOrder, runFor } from './src/engine.js';

const { config, departments, errors } = await loadCity('./city.json');
if (errors.length > 0) {
  console.error('City loading errors:', errors);
  process.exit(1);
}

const city = createCity({ departments });
city.onEvent = (ev) => console.log(`[t=${String(ev.t).padStart(5)}s] ${ev.msg}`);

console.log(`=== Agentropolis City Builder demo: ${config.name} ===\n`);
console.log(`Buildings: ${Object.values(departments).map(d => `${d.emoji} ${d.name}`).join(' | ')}\n`);

issueOrder(city, 'Research electric bikes and write a short report');
issueOrder(city, 'Schedule a dentist appointment for next week');
issueOrder(city, 'Calculate the budget for a 4-day trip');

await runFor(city, 70);

console.log('\n=== Delivered results ===');
for (const task of Object.values(city.tasks)) {
  console.log(`\nOrder #${task.id}: ${task.text}`);
  for (const r of task.results) console.log(`  - [${r.dept}] ${r.output}`);
}
console.log(`\nCity stats: ${city.stats.issued} issued, ${city.stats.delivered} delivered.`);
