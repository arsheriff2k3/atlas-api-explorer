import { cronJobs } from 'convex/server';
import { internal } from './_generated/api';

const crons=cronJobs();
crons.interval('clean orphaned analysis files',{hours:24},internal.maintenance.cleanOrphanedFiles,{});
export default crons;
