import next from "eslint-config-next";

export default [
  ...next,
  { ignores: [".next/**", "node_modules/**", "storage/**", "src/generated/**"] },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "react-hooks/set-state-in-effect": "off",
    },
  },
];
