import * as cdk from 'aws-cdk-lib';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';

export interface NotificationTopicsConstructProps {
  environment: string;
  regionCode: string;
  removalPolicy?: cdk.RemovalPolicy;
}

export class NotificationTopicsConstruct extends Construct {
  public readonly notificationTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: NotificationTopicsConstructProps) {
    super(scope, id);

    const removalPolicy = props.removalPolicy ?? cdk.RemovalPolicy.DESTROY;

    // Notification Topic for delivering notifications
    this.notificationTopic = new sns.Topic(this, 'NotificationTopic', {
      topicName: `${props.environment}-${props.regionCode}-notification-domain-notifications-topic`,
      displayName: 'Hand-Made Platform Notifications',
    });

    if (removalPolicy === cdk.RemovalPolicy.DESTROY) {
      this.notificationTopic.applyRemovalPolicy(removalPolicy);
    }
  }
}
