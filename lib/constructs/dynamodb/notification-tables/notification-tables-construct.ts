import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface NotificationTablesConstructProps {
  environment: string;
  regionCode: string;
  removalPolicy?: cdk.RemovalPolicy;
}

export class NotificationTablesConstruct extends Construct {
  public readonly notificationsTable: dynamodb.Table;
  public readonly notificationPreferencesTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: NotificationTablesConstructProps) {
    super(scope, id);

    const removalPolicy = props.removalPolicy ?? cdk.RemovalPolicy.DESTROY;

    // Notifications Table
    this.notificationsTable = new dynamodb.Table(this, 'NotificationsTable', {
      tableName: `${props.environment}-${props.regionCode}-notification-domain-notifications-table`,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'notificationId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.environment === 'prod' },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });

    // GSI: unread notifications
    this.notificationsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1-Unread',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'readAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // GSI: notifications by type
    this.notificationsTable.addGlobalSecondaryIndex({
      indexName: 'GSI2-Type',
      partitionKey: {
        name: 'type',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
    });

    // Notification Preferences Table
    this.notificationPreferencesTable = new dynamodb.Table(this, 'NotificationPreferencesTable', {
      tableName: `${props.environment}-${props.regionCode}-notification-domain-notification-preferences-table`,
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'notificationType',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: removalPolicy,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: props.environment === 'prod' },
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
    });
  }
}
