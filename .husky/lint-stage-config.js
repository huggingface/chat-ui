export default {
	"*.{js,jsx,ts,tsx}": ["prettier --write", "eslint --fix", "eslint"],
	"*.json": ["prettier --write"],
};
