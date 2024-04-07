import { z } from "zod";
import MODELS from "../models.config";
import { modelConfig } from "../src/lib/server/models";

// EXAMPLE Script to validate the config before even starting the application.
// Would help newbies to understand the config structure and avoid runtime errors.

// Validate the models
z.array(modelConfig).parse(MODELS);
