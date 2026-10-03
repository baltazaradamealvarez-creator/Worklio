import vitals from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";

export default [
  ...vitals,
  ...ts,
  { ignores: [".next/**", "node_modules/**", "storage/**", "src/generated/**"] },
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
      "@next/next/no-img-element": "off",
    },
  },
];
