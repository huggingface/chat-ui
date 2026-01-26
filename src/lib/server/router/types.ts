export interface Route {
	name: string;
	description: string;
	primary_model: string;
	fallback_models?: string[];
}

export interface RouteConfig {
	name: string;
	description: string;
}

export interface RouteSelection {
	routeName: string;
}
