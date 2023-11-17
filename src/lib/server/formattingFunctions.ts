type FunctionParameter = {
	name: string;
	type: string;
	description: string;
};

export type FunctionDescription = {
	endpoint: string;
	method: string;
	description: string;
	bodyParameters: FunctionParameter[];
	response: string;
	exampleRequest: Request;
};

export function translateFunctionsToFormat(functions: FunctionDescription[]): string {
	console.log(functions);
	const formattedFunctions: string[] = [];

	for (let i = 0; i < functions.length; i++) {
		const functionDesc = functions[i];

		// Format parameters
		const paramsFormatted = functionDesc.bodyParameters
			? functionDesc.bodyParameters
					.map(
						(param, index) =>
							`            ${index + 1}. "name": "${param.name}",\n` +
							`               "type": "${param.type}",\n` +
							`               "description": "${param.description}"`
					)
					.join("\n")
			: "";

		// Format the entire function description
		const formattedFunction =
			`[${i + 1}] endpoint: "${functionDesc.endpoint}"\n` +
			`method: "${functionDesc.method}"\n` +
			`description: "${functionDesc.description}",\n` +
			`parameters: \n${paramsFormatted}\n` +
			`response: "${functionDesc.response}"\n` +
			`example request: ${JSON.stringify(functionDesc.exampleRequest, null, 4)}`;

		formattedFunctions.push(formattedFunction);
	}
	console.log("formattedFunctions: ", formattedFunctions);

	return formattedFunctions.join("\n");
}
