# MyAmbagan

A mobile-first ledger for groups to split shared expenses. It records who paid, who owes whom, and who confirmed receiving repayment. It never holds or moves money.

## Language

### People

**Account**:
A verified identity (email, password, emailed code) that owns exactly one Username. Everyone who uses MyAmbagan has one.
_Avoid_: Guest, user profile

**Username**:
The unique, permanent, lowercase name of an Account (letters, numbers, dot, hyphen, underscore). It is how people are identified in every Room.
_Avoid_: Display name, nickname, handle

**Member**:
An Account that has joined a Room. Rejoining a Room restores the same Member.
_Avoid_: Participant, user

**Creator**:
The Member who made a Room. Permanent for the Room's life: cannot leave, be kicked, or hand the Room over, and is the only Member who can delete it.
_Avoid_: Owner, admin, host

**Moderator**:
A Member promoted by the Creator with the Creator's powers except deleting the Room. Only the Moderator can demote themselves; the Creator can remove one only by kicking them.
_Avoid_: Admin, co-host

### Rooms

**Room**:
A group of one to ten current Members that shares a ledger of Bills, identified by a Room ID.
_Avoid_: Group, party

**Room ID**:
Four hyphen-separated five-letter words (e.g. `quick-snake-boots-power`) that lets an Account join a Room.
_Avoid_: Invite code, room code

**Lock**:
A Room state, set by the Creator or a Moderator, that blocks everyone who isn't a current Member from joining, former Members included, until it is unlocked.
_Avoid_: Close, freeze

**Audit log**:
The append-only record of everything that happens in a Room, visible to its Members. Nobody can edit it, including the Creator.
_Avoid_: History, activity feed

### Money

**Bill**:
An expense one Member paid for, posted to a Room to request reimbursement from other Members. It is Pending until the Creator or a Moderator approves or rejects it. Only an approved Bill creates Shares.
_Avoid_: Payment, expense, invoice

**Payer**:
The Member who posted a Bill and is owed the money. Always the poster.
_Avoid_: Creditor, owner

**Share**:
The whole-peso portion of a Bill that one Member owes the Payer. Defaults to an equal split, which the Payer can edit. It is Unpaid, then Marked paid by the debtor, then Settled once the Payer confirms receipt.
_Avoid_: Split, portion, debt

**Void**:
Cancelling an approved Bill and its unsettled Shares. Only the Creator or a Moderator can do it, and only while none of the Bill's Shares are Settled.
_Avoid_: Delete, cancel, refund

## Relationships

- An **Account** has one **Username** and can be a **Member** of many **Room**s.
- A **Bill** belongs to one **Room**, has one **Payer**, and has one **Share** per Member who owes.
- Bills posted by the **Creator** or a **Moderator** are approved automatically; the approval is recorded in the **Audit log**.
- A Member cannot leave, and cannot be kicked, while any of their **Share**s are unsettled.
- Share amounts are whole pesos. When an equal split leaves a remainder, it goes to the **Payer** by default, and the Payer can edit the amounts.
