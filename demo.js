// Headless demo: run the whole city in the terminal, no browser needed.
//   node demo.js
import { createCity, issueOrder, runFor } from './src/engine.js';

const city = createCity();
city.onEvent = (ev) => console.log(`[t=${String(ev.t).padStart(5)}s] ${ev.msg}`);

console.log('=== Agentropolis headless demo (mock departments) ===\n');
issueOrder(city, 'Research electric bikes and write a short report');
issueOrder(city, 'Schedule a dentist appointment for next week');
issueOrder(city, 'Calculate the budget for a 4-day trip and email it to me');

await runFor(city, 60);

console.log('\n=== Delivered results ===');
for (const task of Object.values(city.tasks)) {
  console.log(`\nOrder #${task.id}: ${task.text}`);
  for (const r of task.results) console.log(`  - [${r.dept}] ${r.output}`);
}
console.log(`\nCity stats: ${city.stats.issued} issued, ${city.stats.delivered} delivered.`);
