import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons=cronJobs();
crons.interval('clean orphaned analysis files',{hours:24},internal.maintenance.cleanOrphanedFiles,{});
crons.interval('clean old analysis jobs and usage',{hours:24},internal.jobs.cleanOld,{});
crons.interval('recover queued and stalled analyses',{minutes:1},internal.jobs.recoverPending,{});
export default crons;
