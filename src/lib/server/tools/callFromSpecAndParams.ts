import { OpenAPIV3_1 } from "openapi-types";

export async function callOperationFromSpecAndParams(
	apiSpec: OpenAPIV3_1.Document,
	operationId: string,
	parameters: Record<string, string | boolean | number>
): Promise<string> {
	for (const [path, pathItem] of Object.entries(apiSpec.paths ?? {})) {
		for (const [method, operation] of Object.entries(pathItem ?? {})) {
			if (operation?.operationId === operationId) {
				const url = new URL(apiSpec?.servers?.[0].url + path);
				const headers: HeadersInit = {};

				// Handle query parameters
				if (operation.parameters) {
					operation.parameters.forEach((param: any) => {
						if (param.in === "query" && parameters[param.name]) {
							url.searchParams.append(param.name, parameters[param.name]);
						} else if (param.in === "header" && parameters[param.name]) {
							headers[param.name] = parameters[param.name];
						}
						// Add similar blocks for other parameter locations (path, cookie)
					});
				}

				// Handle request body
				let body = undefined;
				if (operation.requestBody && operation.requestBody.content) {
					const contentType = Object.keys(operation.requestBody.content)[0];
					headers["Content-Type"] = contentType;
					body = JSON.stringify(parameters.body); // Simplistic handling; adjust based on actual content type
				}

				const response = await fetch(url.toString(), {
					method: method.toUpperCase(),
					headers,
					body,
				});

				return response.json(); // Assuming JSON response; adjust as necessary
			}
		}
	}
	throw new Error(`Operation ${operationId} not found`);
}
