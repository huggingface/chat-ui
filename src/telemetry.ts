// This file is built outside of sveltekit and cannot import from the rest of the application
// or special imports like $env/dynamic/private.
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-proto";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-proto";
import { SEMRESATTRS_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { AlwaysOnSampler } from "@opentelemetry/sdk-trace-base";
import { Resource } from "@opentelemetry/resources";

const TRACE_URL =
	process.env.OTEL_EXPORTER_OTLP_ENDPOINT + "/v1/traces" || "http://localhost:4318/v1/traces";
const METRICS_URL =
	process.env.OTEL_EXPORTER_OTLP_ENDPOINT + "/v1/metrics" || "http://localhost:4318/v1/metrics";
const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || "huggingface/chat-ui";

const exporter = new OTLPTraceExporter({
	url: TRACE_URL,
	headers: {},
});

const otelNodeSdk = new NodeSDK({
	autoDetectResources: true,
	serviceName: SERVICE_NAME,
	traceExporter: exporter,
	metricReader: new PeriodicExportingMetricReader({
		exporter: new OTLPMetricExporter({
			url: METRICS_URL,
			headers: {},
		}),
	}),
	sampler: new AlwaysOnSampler(),
	resource: new Resource({
		[SEMRESATTRS_SERVICE_NAME]: SERVICE_NAME,
	}),
	instrumentations: [
		getNodeAutoInstrumentations({
			"@opentelemetry/instrumentation-http": {
				ignoreIncomingRequestHook: (request) => {
					// Don't trace static asset requests
					if (
						request.url?.endsWith(".js") ||
						request.url?.endsWith(".svg") ||
						request.url?.endsWith(".css")
					) {
						return false;
					}
					return true;
				},
			},
		}),
	],
});

export class Telemetry {
	private static instance: Telemetry;
	private initialized = false;

	private constructor() {}

	public static getInstance(): Telemetry {
		if (!Telemetry.instance) {
			Telemetry.instance = new Telemetry();
		}
		return Telemetry.instance;
	}

	public start() {
		if (!this.initialized) {
			this.initialized = true;
			otelNodeSdk.start();
		}
	}
}

Telemetry.getInstance().start();
