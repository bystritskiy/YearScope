import { config } from './config.ts';
import { logReports, runSync } from './sync.ts';
import { buildSummary } from './summary.ts';

/** A one-off run without starting the server: handy for checking sources by hand. */

const yearArg = process.argv[2];
const year = yearArg ? Number.parseInt(yearArg, 10) : config.year;

const reports = await runSync(year);
logReports(`manual run for ${year}`, reports);

const summary = buildSummary(year);
const hours = (seconds: number) => (seconds / 3600).toFixed(1).padStart(7);

console.log(`\nTotal for ${year}: ${(summary.totalSeconds / 3600).toFixed(1)} h`);
for (const source of summary.sources) {
  if (!source.configured) continue;
  const share = (source.share * 100).toFixed(0).padStart(3);
  console.log(`  ${source.icon} ${source.label.padEnd(10)} ${hours(source.seconds)} h  ${share}%`);
}
