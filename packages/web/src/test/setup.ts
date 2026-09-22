import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Auto-cleanup DOM po każdym teście komponentu — bez tego kolejne `render()` w jednym pliku
// się nakładają.
afterEach(() => cleanup());
