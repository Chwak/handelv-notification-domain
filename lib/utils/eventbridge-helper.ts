import * as ssm from "aws-cdk-lib/aws-ssm";
import * as events from "aws-cdk-lib/aws-events";
import type { Construct } from "constructs";

/**
 * Import the shared EventBus from the shared-infra stack via SSM parameter
 */
export function importEventBusFromSharedInfra(scope: Construct, environment: string): events.IEventBus {
  const eventBusNameParam = ssm.StringParameter.fromStringParameterAttributes(
    scope,
    "SharedEventBusName",
    {
      parameterName: `/${environment}/shared-infra/eventbridge/event-bus-name`,
    }
  );

  return events.EventBus.fromEventBusName(
    scope,
    "SharedEventBus",
    eventBusNameParam.stringValue
  );
}

/**
 * Get the event bus ARN from the shared-infra stack via SSM parameter
 */
export function getEventBusArnFromSharedInfra(scope: Construct, environment: string): string {
  const eventBusNameParam = ssm.StringParameter.fromStringParameterAttributes(
    scope,
    "SharedEventBusNameForArn",
    {
      parameterName: `/${environment}/shared-infra/eventbridge/event-bus-name`,
    }
  );

  return eventBusNameParam.stringValue;
}
