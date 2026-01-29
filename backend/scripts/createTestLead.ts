// scripts/createTestLead.ts
// Create a test lead eligible for batch calling

import prisma from '../src/prisma';

async function createTestLead() {
  try {
    console.log('🔍 Finding most recent campaign...');
    
    // Step 1: Find the most recent Campaign
    const campaign = await prisma.campaign.findFirst({
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!campaign) {
      throw new Error('No campaigns found in database. Please create a campaign first.');
    }

    console.log(`✅ Found campaign: ${campaign.id} (${campaign.name})`);

    // Step 2: Create a new Contact
    console.log('📝 Creating new contact...');
    const contact = await prisma.contact.create({
      data: {
        name: 'Batch Test Lead',
        phone: '+919999000001',
        email: 'batch-test@lead.com',
        userId: campaign.userId, // Use the same userId as the campaign
      },
    });

    console.log(`✅ Created contact: ${contact.id}`);

    // Step 3: Create CampaignContact with NOT_PICK status and null lastCallAt
    console.log('🔗 Linking contact to campaign...');
    const campaignContact = await prisma.campaignContact.create({
      data: {
        campaignId: campaign.id,
        contactId: contact.id,
        status: 'NOT_PICK',
        lastCallAt: null, // Explicitly set to null for eligibility
      },
    });

    console.log(`✅ Created campaign contact: ${campaignContact.id}`);

    // Verify eligibility
    const callCount = await prisma.callLog.count({
      where: {
        campaignContactId: campaignContact.id,
        resultStatus: 'NOT_PICK',
      },
    });

    console.log('\n📊 Test Lead Created Successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Campaign ID:        ${campaign.id}`);
    console.log(`Contact ID:         ${contact.id}`);
    console.log(`Campaign Contact ID: ${campaignContact.id}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`Status:              ${campaignContact.status}`);
    console.log(`Last Call At:        ${campaignContact.lastCallAt || 'NULL'}`);
    console.log(`NOT_PICK Retries:    ${callCount}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('✅ Lead is eligible for batch calling');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  } catch (error: any) {
    console.error('❌ Error creating test lead:', error.message);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// Run the script
createTestLead()
  .then(() => {
    console.log('✨ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Script failed:', error);
    process.exit(1);
  });
