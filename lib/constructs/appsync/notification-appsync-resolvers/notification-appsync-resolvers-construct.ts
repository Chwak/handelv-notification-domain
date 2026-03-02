import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

export interface NotificationAppSyncResolversConstructProps {
  api: appsync.IGraphqlApi;
  createNotificationLambda?: lambda.IFunction;
  getNotificationsLambda?: lambda.IFunction;
  markNotificationReadLambda?: lambda.IFunction;
  updatePreferencesLambda?: lambda.IFunction;
  deliverNotificationLambda?: lambda.IFunction;
}

export class NotificationAppSyncResolversConstruct extends Construct {
  constructor(scope: Construct, id: string, props: NotificationAppSyncResolversConstructProps) {
    super(scope, id);

    if (props.getNotificationsLambda) {
      const getNotificationsDataSource = props.api.addLambdaDataSource(
        'GetNotificationsDataSource',
        props.getNotificationsLambda
      );

      getNotificationsDataSource.createResolver('GetNotificationsResolver', {
        typeName: 'Query',
        fieldName: 'getNotifications',
        requestMappingTemplate: appsync.MappingTemplate.lambdaRequest(),
        responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
      });
    }

    // Note: createNotification is event-driven, not exposed as GraphQL mutation
    // if (props.createNotificationLambda) {
    //   const createNotificationDataSource = props.api.addLambdaDataSource(
    //     'CreateNotificationDataSource',
    //     props.createNotificationLambda
    //   );

    //   createNotificationDataSource.createResolver('CreateNotificationResolver', {
    //     typeName: 'Mutation',
    //     fieldName: 'createNotification',
    //     requestMappingTemplate: appsync.MappingTemplate.lambdaRequest(),
    //     responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    //   });
    // }

    if (props.markNotificationReadLambda) {
      const markNotificationReadDataSource = props.api.addLambdaDataSource(
        'MarkNotificationReadDataSource',
        props.markNotificationReadLambda
      );

      markNotificationReadDataSource.createResolver('MarkNotificationReadResolver', {
        typeName: 'Mutation',
        fieldName: 'markNotificationRead',
        requestMappingTemplate: appsync.MappingTemplate.lambdaRequest(),
        responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
      });
    }

    if (props.updatePreferencesLambda) {
      const updatePreferencesDataSource = props.api.addLambdaDataSource(
        'UpdatePreferencesDataSource',
        props.updatePreferencesLambda
      );

      updatePreferencesDataSource.createResolver('UpdatePreferencesResolver', {
        typeName: 'Mutation',
        fieldName: 'updateNotificationPreferences',
        requestMappingTemplate: appsync.MappingTemplate.lambdaRequest(),
        responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
      });
    }

    // Note: deliverNotification is event-driven, not exposed as GraphQL mutation
    // if (props.deliverNotificationLambda) {
    //   const deliverNotificationDataSource = props.api.addLambdaDataSource(
    //     'DeliverNotificationDataSource',
    //     props.deliverNotificationLambda
    //   );

    //   deliverNotificationDataSource.createResolver('DeliverNotificationResolver', {
    //     typeName: 'Mutation',
    //     fieldName: 'deliverNotification',
    //     requestMappingTemplate: appsync.MappingTemplate.lambdaRequest(),
    //     responseMappingTemplate: appsync.MappingTemplate.lambdaResult(),
    //   });
    // }
  }
}
