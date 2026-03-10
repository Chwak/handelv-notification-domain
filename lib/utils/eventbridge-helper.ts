import * as ssm from "aws-cdk-lib/aws-ssm";
import * as events from "aws-cdk-lib/aws-events";
import type { Construct } from "constructs";

/**
 * Import the shared EventBus from the shared-infra stack via SSM parameter
 */
export function importEventBusFromSharedInfra(scope: Construct, environment: string): events.IEventBus {
  const eventBusArnParam = ssm.StringParameter.fromStringParameterAttributes(
    scope,
    "SharedEventBusArn",
    {
      parameterName: `/${environment}/shared-infra/eventbridge/event-bus-arn`,
    }
  );

  return events.EventBus.fromEventBusArn(
    scope,
    "SharedEventBus",
    eventBusArnParam.stringValue
  );
}

/**
 * Get the event bus ARN from the shared-infra stack via SSM parameter
 */
export function getEventBusArnFromSharedInfra(scope: Construct, environment: string): string {
  const eventBusArnParam = ssm.StringParameter.fromStringParameterAttributes(
    scope,
    "SharedEventBusArnForArn",
    {
      parameterName: `/${environment}/shared-infra/eventbridge/event-bus-arn`,
    }
  );

  return eventBusArnParam.stringValue;
}
