import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const OC = join(homedir(), '.openclaw');
const token = (await readFile(join(OC, 'city_builder', 'builder-token.txt'), 'utf8')).trim();
const prompt = 'add a research observatory and connect it to the engineering factory';

const res = await fetch('http://127.0.0.1:8347/api/city/ai-plan', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-builder-token': token },
  body: JSON.stringify({ prompt }),
});
const body = await res.text();
console.log('STATUS', res.status);
console.log('BODY', body);
try {
  const j = JSON.parse(body);
  if (!j.ok) process.exit(2);
  if (!j.city || !Array.isArray(j.city.departments)) process.exit(3);
  console.log('AI PLAN OK: cityName=' + j.city.cityName + ', departments=' + j.city.departments.length + ', model=' + j.model);
} catch (e) {
  console.error('JSON parse failed:', e.message);
  process.exit(4);
}
