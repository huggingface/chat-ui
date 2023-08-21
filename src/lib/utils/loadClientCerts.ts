import * as fs from "fs";
import { setGlobalDispatcher, Agent } from "undici";

/**
 * Load client certificates for mutual TLS authentication. This function must be called before any HTTP requests are made.
 * This is a global setting that affects all HTTP requests made by the application using the native fetch API.
 *
 * @param clientCertPath     Path to client certificate
 * @param clientKeyPath      Path to client key
 * @param caCertPath         Path to CA certificate [optional]
 * @param clientKeyPassword  Password for client key [optional]
 * @param rejectUnauthorized Reject unauthorized certificates.
 *                           Only use for testing/development, not recommended in production environments [optional]
 *
 * @returns void
 *
 * @example
 * ```typescript
 * loadClientCertificates("cert.pem", "key.pem", "ca.pem", "password", false);
 * ```
 *
 * @see
 * [Undici Agent](https://undici.nodejs.org/#/docs/api/Agent)
 * @see
 * [Undici Dispatcher](https://undici.nodejs.org/#/docs/api/Dispatcher)
 * @see
 * [NodeJS Native Fetch API](https://nodejs.org/docs/latest-v19.x/api/globals.html#fetch)
 */
export function loadClientCertificates(
	clientCertPath: string,
	clientKeyPath: string,
	caCertPath?: string,
	clientKeyPassword?: string,
	rejectUnauthorized?: boolean
): void {
	const clientCert = fs.readFileSync(clientCertPath);
	const clientKey = fs.readFileSync(clientKeyPath);
	const caCert = caCertPath ? fs.readFileSync(caCertPath) : undefined;
	const agent = new Agent({
		connect: {
			cert: clientCert,
			key: clientKey,
			ca: caCert,
			passphrase: clientKeyPassword,
			rejectUnauthorized: rejectUnauthorized,
		},
	});

	setGlobalDispatcher(agent);
}
