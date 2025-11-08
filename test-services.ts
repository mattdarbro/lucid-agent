/**
 * Test script to verify services work with real database
 *
 * Run with: npx tsx test-services.ts
 */

import { UserService } from './src/services/user.service';
import { ConversationService } from './src/services/conversation.service';
import { MessageService } from './src/services/message.service';
import { VectorService } from './src/services/vector.service';
import { pool } from './src/db';

async function testServices() {
  console.log('🧪 Testing Lucid Agent Services...\n');

  try {
    // Test 1: Check database connection
    console.log('1️⃣ Testing database connection...');
    const dbTest = await pool.query('SELECT NOW()');
    console.log('   ✅ Database connected:', dbTest.rows[0].now);

    // Test 2: Check pgvector extension
    console.log('\n2️⃣ Checking pgvector extension...');
    try {
      const vectorTest = await pool.query(`
        SELECT extversion FROM pg_extension WHERE extname = 'vector'
      `);
      if (vectorTest.rows.length > 0) {
        console.log('   ✅ pgvector installed:', vectorTest.rows[0].extversion);
      } else {
        console.log('   ⚠️  pgvector not found - semantic search will not work');
        console.log('   Run: CREATE EXTENSION vector;');
      }
    } catch (error) {
      console.log('   ⚠️  Could not check pgvector:', error);
    }

    // Test 3: UserService
    console.log('\n3️⃣ Testing UserService...');
    const userService = new UserService(pool);
    const testUser = await userService.createOrUpdateUser({
      external_id: `test_${Date.now()}`,
      name: 'Test User',
      email: 'test@example.com',
      timezone: 'America/Los_Angeles',
    });
    console.log('   ✅ User created:', testUser.id);
    console.log('      Name:', testUser.name);
    console.log('      Timezone:', testUser.timezone);

    // Test 4: ConversationService
    console.log('\n4️⃣ Testing ConversationService...');
    const conversationService = new ConversationService(pool);
    const testConversation = await conversationService.createConversation({
      user_id: testUser.id,
      title: 'Test Conversation',
    });
    console.log('   ✅ Conversation created:', testConversation.id);
    console.log('      Title:', testConversation.title);
    console.log('      Message count:', testConversation.message_count);

    // Test 5: VectorService (without OpenAI call)
    console.log('\n5️⃣ Testing VectorService...');
    const vectorService = new VectorService();
    console.log('   ✅ VectorService initialized');
    console.log('      Model:', vectorService.getModel());
    console.log('      Dimensions:', vectorService.getDimensions());

    // Test cosine similarity
    const vec1 = new Array(1536).fill(0.1);
    const vec2 = new Array(1536).fill(0.1);
    const similarity = vectorService.cosineSimilarity(vec1, vec2);
    console.log('      Cosine similarity (identical vectors):', similarity.toFixed(4));

    // Test 6: MessageService (without embedding to avoid API call)
    console.log('\n6️⃣ Testing MessageService...');
    const messageService = new MessageService(pool);
    const testMessage = await messageService.createMessage({
      conversation_id: testConversation.id,
      user_id: testUser.id,
      role: 'user',
      content: 'Hello, this is a test message!',
      skip_embedding: true, // Skip to avoid OpenAI API call
    });
    console.log('   ✅ Message created:', testMessage.id);
    console.log('      Role:', testMessage.role);
    console.log('      Content:', testMessage.content.substring(0, 50) + '...');
    console.log('      Tokens:', testMessage.tokens);

    // Test 7: List messages
    console.log('\n7️⃣ Testing message retrieval...');
    const messages = await messageService.listByConversation(testConversation.id);
    console.log('   ✅ Messages retrieved:', messages.length);

    // Test 8: Get conversation count
    console.log('\n8️⃣ Testing conversation count...');
    const messageCount = await messageService.getCountByConversation(testConversation.id);
    console.log('   ✅ Message count:', messageCount);

    // Cleanup
    console.log('\n🧹 Cleaning up test data...');
    await messageService.deleteMessage(testMessage.id);
    await conversationService.deleteConversation(testConversation.id);
    await userService.deleteUser(testUser.id);
    console.log('   ✅ Test data cleaned up');

    console.log('\n✅ ALL TESTS PASSED! 🎉');
    console.log('\nYour services are working correctly!');
    console.log('\nNext steps:');
    console.log('  - To test with embeddings, ensure OPENAI_API_KEY is set');
    console.log('  - Try creating messages without skip_embedding: true');
    console.log('  - Test semantic search with messageService.semanticSearch()');

  } catch (error) {
    console.error('\n❌ TEST FAILED:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run tests
testServices().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
