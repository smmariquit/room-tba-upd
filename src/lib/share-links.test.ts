import { describe, expect, test } from "bun:test";
import { campusSite } from "../campus.config.ts";
import { getJeepneyRouteShareUrl } from "./share-links.js";

describe("getJeepneyRouteShareUrl", () => {
  test("builds a jeepney deep link without a stop", () => {
    expect(getJeepneyRouteShareUrl("kaliwa-kanan")).toBe(
      `${campusSite.url}/transit/kaliwa-kanan/`,
    );
  });

  test("appends the stop index when given", () => {
    expect(getJeepneyRouteShareUrl("forestry", 3)).toBe(
      `${campusSite.url}/transit/forestry/narra-bridge/`,
    );
  });

  test("includes stop=0 (index is not treated as absent)", () => {
    expect(getJeepneyRouteShareUrl("forestry", 0)).toBe(
      `${campusSite.url}/transit/forestry/forestry-jeep-terminal/`,
    );
  });

  test("url-encodes the route id", () => {
    expect(getJeepneyRouteShareUrl("a b/c")).toBe(
      `${campusSite.url}/transit/a%20b%2Fc/`,
    );
  });
});
