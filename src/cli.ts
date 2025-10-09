#!/usr/bin/env node

import { runServer } from "./server/index.js";

// Run the server and handle any fatal errors
runServer().catch((error) => {
  console.error("Fatal error running server:", error);
  process.exit(1);
});
