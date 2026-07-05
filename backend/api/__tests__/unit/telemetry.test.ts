import { describe, expect, it } from "vitest";
import { BuildTelemetry } from "../../src/infra/telemetry";

describe("BuildTelemetry", () => {
  it("stores only serializable model route decision fields", () => {
    const telemetry = new BuildTelemetry({ id: "telemetry-test" });
    const circularClient: Record<string, unknown> = {};
    circularClient.self = circularClient;

    telemetry.addModelRouteDecision({
      role: "editor",
      provider: "glm",
      model: "glm-5.2",
      reason: "role-primary",
      routingMode: "role_first",
      fallbackIndex: 0,
      client: circularClient,
    } as any);

    const snapshot = telemetry.snapshot();
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    expect(snapshot.modelRouteDecisions?.[0]).toEqual({
      role: "editor",
      provider: "glm",
      model: "glm-5.2",
      reason: "role-primary",
      routingMode: "role_first",
      fallbackIndex: 0,
    });
  });
});
