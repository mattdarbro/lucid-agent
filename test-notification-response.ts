/**
 * Test script to check notification response format
 * Run with: tsx test-notification-response.ts
 */

import { pool } from './src/db';
import { ThoughtNotificationService } from './src/services/thought-notification.service';

async function testNotificationResponse() {
  const notificationService = new ThoughtNotificationService(pool);

  try {
    console.log('Testing notification response format...\n');

    // Get all pending notifications
    const query = `
      SELECT * FROM thought_notifications
      WHERE status = 'pending'
      LIMIT 1
    `;

    const result = await pool.query(query);

    if (result.rows.length === 0) {
      console.log('No pending notifications found in database');
      console.log('\nCreating a test notification...');

      // Get first user
      const userResult = await pool.query('SELECT id FROM users LIMIT 1');
      if (userResult.rows.length === 0) {
        console.log('No users found. Please create a user first.');
        process.exit(1);
      }

      const userId = userResult.rows[0].id;

      const notification = await notificationService.createNotification({
        user_id: userId,
        question: 'Test notification',
        context: 'Testing',
        preferred_time_of_day: 'morning',
        preferred_cognitive_state: 'any',
        priority: 0.5,
      });

      console.log('\nTest notification created:', notification.id);
      console.log('\nJSON Response:');
      console.log(JSON.stringify(notification, null, 2));
    } else {
      const notification = result.rows[0];
      console.log('Found pending notification:', notification.id);
      console.log('\nRaw database row:');
      console.log(notification);
      console.log('\nJSON Response (as would be sent to iOS):');
      console.log(JSON.stringify(notification, null, 2));
    }

    // Test the getPendingNotifications service method
    const userResult = await pool.query('SELECT id FROM users LIMIT 1');
    if (userResult.rows.length > 0) {
      const userId = userResult.rows[0].id;
      console.log('\n\n=== Testing getPendingNotifications Service ===');
      const notifications = await notificationService.getPendingNotifications(userId, 10);
      console.log('\nResponse from service:');
      console.log(JSON.stringify({
        notifications,
        count: notifications.length,
        user_id: userId,
      }, null, 2));
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

testNotificationResponse();
