/** Entry point for running the API as a standalone process. */
import { startServer } from './server.js';

if (process.env.NODE_ENV !== 'test') {
  startServer();
}
