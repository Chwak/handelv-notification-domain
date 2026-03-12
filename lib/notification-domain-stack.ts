import * as cdk from "aws-cdk-lib";
import * as ssm from "aws-cdk-lib/aws-ssm";
import * as events from "aws-cdk-lib/aws-events";
import type { Construct } from "constructs";
import type { DomainStackProps } from "./domain-stack-props";
import { NotificationAppSyncConstruct } from "./constructs/appsync/notification-appsync/notification-appsync-construct";
import { NotificationTablesConstruct } from "./constructs/dynamodb/notification-tables/notification-tables-construct";
import { OutboxTableConstruct } from "./constructs/dynamodb/outbox-table/outbox-table-construct";
import { CreateNotificationLambdaConstruct } from "./constructs/lambda/notification/create-notification/create-notification-lambda-construct";
import { GetNotificationsLambdaConstruct } from "./constructs/lambda/notification/get-notifications/get-notifications-lambda-construct";
import { MarkNotificationReadLambdaConstruct } from "./constructs/lambda/notification/mark-notification-read/mark-notification-read-lambda-construct";
import { UpdatePreferencesLambdaConstruct } from "./constructs/lambda/notification/update-preferences/update-preferences-lambda-construct";
import { DeliverNotificationLambdaConstruct } from "./constructs/lambda/notification/deliver-notification/deliver-notification-lambda-construct";
import { NotificationTopicsConstruct } from "./constructs/sns/notification-topics/notification-topics-construct";
import { NotificationAppSyncResolversConstruct } from "./constructs/appsync/notification-appsync-resolvers/notification-appsync-resolvers-construct";
import { OrderCreatedConsumerLambdaConstruct } from "./constructs/lambda/event-consumer/order-created-consumer-lambda-construct";
import { OrderPaidConsumerLambdaConstruct } from "./constructs/lambda/event-consumer/order-paid-consumer-lambda-construct";
import { OrderStockConfirmedConsumerLambdaConstruct } from "./constructs/lambda/event-consumer/order-stock-confirmed-consumer-lambda-construct";
import { CommissionProposalSubmittedConsumerLambdaConstruct } from "./constructs/lambda/event-consumer/commission-proposal-submitted-consumer-lambda-construct";
import { CommissionProposalAcceptedConsumerLambdaConstruct } from "./constructs/lambda/event-consumer/commission-proposal-accepted-consumer-lambda-construct";
import { CommissionProposalDeclinedConsumerLambdaConstruct } from "./constructs/lambda/event-consumer/commission-proposal-declined-consumer-lambda-construct";
import { CommissionMilestoneClipAddedConsumerLambdaConstruct } from "./constructs/lambda/event-consumer/commission-milestone-clip-added-consumer-lambda-construct";
import { importEventBusFromSharedInfra } from "./utils/eventbridge-helper";
import { RepublishLambdaConstruct } from "./constructs/lambda/republish/republish-lambda-construct";

export class NotificationDomainStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: DomainStackProps) {
    super(scope, id, props);

    cdk.Tags.of(this).add("Domain", "hand-made-notification-domain");
    cdk.Tags.of(this).add("Environment", props.environment);
    cdk.Tags.of(this).add("Project", "hand-made");
    cdk.Tags.of(this).add("Region", props.regionCode);
    cdk.Tags.of(this).add("StackName", this.stackName);

    const removalPolicy = props.environment === 'prod'
      ? cdk.RemovalPolicy.RETAIN
      : cdk.RemovalPolicy.DESTROY;

    const schemaRegistryName = ssm.StringParameter.valueForStringParameter(
      this,
      `/${props.environment}/shared-infra/glue/schema-registry-name`,
    );

    // Create SNS topics for notifications
    const notificationTopics = new NotificationTopicsConstruct(this, "NotificationTopics", {
      environment: props.environment,
      regionCode: props.regionCode,
      removalPolicy,
    });

    // Create DynamoDB tables
    const notificationTables = new NotificationTablesConstruct(this, "NotificationTables", {
      environment: props.environment,
      regionCode: props.regionCode,
      removalPolicy,
    });

    const outboxTable = new OutboxTableConstruct(this, "OutboxTable", {
      environment: props.environment,
      regionCode: props.regionCode,
      domainName: "notification-domain",
      removalPolicy,
    });

    const notificationAppSync = new NotificationAppSyncConstruct(this, "NotificationAppSync", {
      environment: props.environment,
      regionCode: props.regionCode,
    });

    // Create Lambda functions
    const createNotificationLambda = new CreateNotificationLambdaConstruct(this, "CreateNotificationLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      notificationsTable: notificationTables.notificationsTable,
      notificationTopic: notificationTopics.notificationTopic,
      removalPolicy,
    });

    const getNotificationsLambda = new GetNotificationsLambdaConstruct(this, "GetNotificationsLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      notificationsTable: notificationTables.notificationsTable,
      removalPolicy,
    });

    const markNotificationReadLambda = new MarkNotificationReadLambdaConstruct(this, "MarkNotificationReadLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      notificationsTable: notificationTables.notificationsTable,
      removalPolicy,
    });

    const updatePreferencesLambda = new UpdatePreferencesLambdaConstruct(this, "UpdatePreferencesLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      notificationPreferencesTable: notificationTables.notificationPreferencesTable,
      removalPolicy,
    });

    const deliverNotificationLambda = new DeliverNotificationLambdaConstruct(this, "DeliverNotificationLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      notificationsTable: notificationTables.notificationsTable,
      notificationPreferencesTable: notificationTables.notificationPreferencesTable,
      notificationTopic: notificationTopics.notificationTopic,
      removalPolicy,
    });

    // Step 0: Import shared EventBus from shared-infra
    const eventBus = importEventBusFromSharedInfra(this, props.environment);

    new RepublishLambdaConstruct(this, "RepublishLambda", {
      environment: props.environment,
      regionCode: props.regionCode,
      domainName: "notification-domain",
      outboxTable: outboxTable.table,
      eventBus,
      schemaRegistryName,
      removalPolicy,
    });

    // Step N: Create event consumer lambdas for cross-domain events
    const orderCreatedConsumer = new OrderCreatedConsumerLambdaConstruct(this, "OrderCreatedConsumer", {
      environment: props.environment,
      regionCode: props.regionCode,
      notificationsTable: notificationTables.notificationsTable,
      outboxTable: outboxTable.table,
      eventBus,
      removalPolicy,
    });

    const orderPaidConsumer = new OrderPaidConsumerLambdaConstruct(this, "OrderPaidConsumer", {
      environment: props.environment,
      regionCode: props.regionCode,
      notificationsTable: notificationTables.notificationsTable,
      outboxTable: outboxTable.table,
      eventBus,
      removalPolicy,
    });

    const orderStockConfirmedConsumer = new OrderStockConfirmedConsumerLambdaConstruct(this, "OrderStockConfirmedConsumer", {
      environment: props.environment,
      regionCode: props.regionCode,
      notificationsTable: notificationTables.notificationsTable,
      outboxTable: outboxTable.table,
      eventBus,
      removalPolicy,
    });

    new CommissionProposalSubmittedConsumerLambdaConstruct(this, "CommissionProposalSubmittedConsumer", {
      environment: props.environment,
      regionCode: props.regionCode,
      notificationsTable: notificationTables.notificationsTable,
      outboxTable: outboxTable.table,
      eventBus,
      removalPolicy,
    });

    new CommissionProposalAcceptedConsumerLambdaConstruct(this, "CommissionProposalAcceptedConsumer", {
      environment: props.environment,
      regionCode: props.regionCode,
      notificationsTable: notificationTables.notificationsTable,
      outboxTable: outboxTable.table,
      eventBus,
      removalPolicy,
    });

    new CommissionProposalDeclinedConsumerLambdaConstruct(this, "CommissionProposalDeclinedConsumer", {
      environment: props.environment,
      regionCode: props.regionCode,
      notificationsTable: notificationTables.notificationsTable,
      outboxTable: outboxTable.table,
      eventBus,
      removalPolicy,
    });

    new CommissionMilestoneClipAddedConsumerLambdaConstruct(this, "CommissionMilestoneClipAddedConsumer", {
      environment: props.environment,
      regionCode: props.regionCode,
      notificationsTable: notificationTables.notificationsTable,
      outboxTable: outboxTable.table,
      eventBus,
      removalPolicy,
    });

    // Create AppSync resolvers
    const notificationResolvers = new NotificationAppSyncResolversConstruct(this, "NotificationResolvers", {
      api: notificationAppSync.api,
      createNotificationLambda: createNotificationLambda.function,
      getNotificationsLambda: getNotificationsLambda.function,
      markNotificationReadLambda: markNotificationReadLambda.function,
      updatePreferencesLambda: updatePreferencesLambda.function,
      deliverNotificationLambda: deliverNotificationLambda.function,
    });
  }
}
