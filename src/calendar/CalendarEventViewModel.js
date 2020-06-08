//@flow
import type {CalendarInfo} from "./CalendarView"
import type {AlarmIntervalEnum, CalendarAttendeeStatusEnum, EndTypeEnum, RepeatPeriodEnum} from "../api/common/TutanotaConstants"
import {
	CalendarAttendeeStatus,
	EndType,
	getAttendeeStatus,
	RepeatPeriod,
	ShareCapability,
	TimeFormat
} from "../api/common/TutanotaConstants"
import type {CalendarEventAttendee} from "../api/entities/tutanota/CalendarEventAttendee"
import {createCalendarEventAttendee} from "../api/entities/tutanota/CalendarEventAttendee"
import type {CalendarEvent} from "../api/entities/tutanota/CalendarEvent"
import {createCalendarEvent} from "../api/entities/tutanota/CalendarEvent"
import type {AlarmInfo} from "../api/entities/sys/AlarmInfo"
import {createAlarmInfo} from "../api/entities/sys/AlarmInfo"
import type {MailboxDetail} from "../mail/MailModel"
import stream from "mithril/stream/stream.js"
import {getDefaultSenderFromUser, getEnabledMailAddressesWithUser} from "../mail/MailUtils"
import {
	assignEventId,
	createRepeatRuleWithValues,
	filterInt,
	generateUid,
	getAllDayDateForTimezone,
	getAllDayDateUTCFromZone,
	getDiffInDays,
	getEventEnd,
	getEventStart,
	getStartOfDayWithZone,
	getStartOfNextDayWithZone,
	hasCapabilityOnGroup,
	parseTime,
	timeString,
	timeStringFromParts,
	timeStringInZone
} from "./CalendarUtils"
import {clone, downcast, neverNull, noOp} from "../api/common/utils/Utils"
import {generateEventElementId, isAllDayEvent} from "../api/common/utils/CommonCalendarUtils"
import {CalendarModel, incrementByRepeatPeriod} from "./CalendarModel"
import m from "mithril"
import {DateTime} from "luxon"
import type {EncryptedMailAddress} from "../api/entities/tutanota/EncryptedMailAddress"
import {createEncryptedMailAddress} from "../api/entities/tutanota/EncryptedMailAddress"
import {findAndRemove, firstThrow} from "../api/common/utils/ArrayUtils"
import {load} from "../api/main/Entity"
import {NotFoundError} from "../api/common/error/RestError"
import type {CalendarRepeatRule} from "../api/entities/tutanota/CalendarRepeatRule"
import {isSameId, listIdPart} from "../api/common/EntityFunctions"
import {UserAlarmInfoTypeRef} from "../api/entities/sys/UserAlarmInfo"
import type {User} from "../api/entities/sys/User"
import {incrementDate} from "../api/common/utils/DateUtils"
import type {CalendarUpdateDistributor} from "./CalendarUpdateDistributor"
import type {IUserController} from "../api/main/UserController"
import type {TranslationKeyType} from "../misc/TranslationKey"
import {createMailAddress} from "../api/entities/tutanota/MailAddress"

const TIMESTAMP_ZERO_YEAR = 1970

export type EventCreateResult =
	| {status: "ok", askForUpdates: ?((bool) => Promise<void>)}
	| {status: "error", error: TranslationKeyType}

export class CalendarEventViewModel {
	+summary: Stream<string>;
	+calendars: Array<CalendarInfo>;
	+selectedCalendar: Stream<CalendarInfo>;
	startDate: Date;
	endDate: Date;
	startTime: string;
	endTime: string;
	+allDay: Stream<boolean>;
	repeat: ?{frequency: RepeatPeriodEnum, interval: number, endType: EndTypeEnum, endValue: number}
	+attendees: Array<CalendarEventAttendee>;
	organizer: ?string;
	+possibleOrganizers: $ReadOnlyArray<string>;
	+location: Stream<string>;
	note: string;
	+amPmFormat: bool;
	+existingEvent: ?CalendarEvent
	_oldStartTime: ?string;
	+readOnly: bool;
	+_zone: string;
	// We keep alarms read-only so that view can diff just array and not all elements
	alarms: $ReadOnlyArray<AlarmInfo>;
	going: CalendarAttendeeStatusEnum;
	_user: User;
	+_isInSharedCalendar: boolean;
	+_distributor: CalendarUpdateDistributor;
	+_calendarModel: CalendarModel;
	+_mailAddresses: Array<string>

	constructor(
		userController: IUserController,
		distributor: CalendarUpdateDistributor,
		calendarModel: CalendarModel,
		mailboxDetail: MailboxDetail,
		date: Date,
		zone: string,
		calendars: Map<Id, CalendarInfo>,
		existingEvent?: ?CalendarEvent
	) {
		this._distributor = distributor
		this._calendarModel = calendarModel
		this.summary = stream("")
		this.calendars = Array.from(calendars.values())
		this.selectedCalendar = stream(this.calendars[0])
		// TODO: check if it's okay to clone here regarding hidden fields
		this.attendees = existingEvent && existingEvent.attendees.map(clone) || []
		const existingOrganizer = existingEvent && existingEvent.organizer
		this.organizer = existingOrganizer || getDefaultSenderFromUser(userController)
		this.location = stream("")
		this.note = ""
		this.allDay = stream(true)
		this.amPmFormat = userController.userSettingsGroupRoot.timeFormat === TimeFormat.TWELVE_HOURS
		this.existingEvent = existingEvent
		this._zone = zone
		this.alarms = []
		this._mailAddresses = getEnabledMailAddressesWithUser(mailboxDetail, userController.userGroupInfo)
		const ownAttendee = this._findOwnAttendee()
		this.going = ownAttendee ? getAttendeeStatus(ownAttendee) : CalendarAttendeeStatus.NEEDS_ACTION
		this._user = userController.user

		/**
		 * Capability for events is fairly complicated:
		 * Note: share "shared" means "not owner of the calendar". Calendar always looks like personal for the owner.
		 *
		 * | Calendar | isCopy  | edit details    | own attendance | guests | organizer
		 * |----------|---------|-----------------|----------------|--------|----------
		 * | Personal | no      | yes             | yes            | yes    | yes
		 * | Personal | yes     | yes (local)     | yes            | no     | no
		 * | Shared   | no      | yes***          | no             | no*    | no*
		 * | Shared   | yes     | yes*** (local)  | no**           | no*    | no*
		 *
		 *   * we don't allow sharing in other people's calendar because later only organizer can modify event and
		 *   we don't want to prevent calendar owner from editing events in their own calendar.
		 *
		 *   ** this is not "our" copy of the event, from the point of organizer we saw it just accidentally.
		 *   Later we might support proposing ourselves as attendee but currently organizer should be asked to
		 *   send out the event.
		 *
		 *   *** depends on share capability. Cannot edit if it's not a copy and there are attendees.
		 */


		this._isInSharedCalendar = false // Default

		if (!existingEvent) {
			this.readOnly = false
		} else {
			// OwnerGroup is not set for events from file
			const calendarInfoForEvent = existingEvent._ownerGroup && calendars.get(existingEvent._ownerGroup)
			if (calendarInfoForEvent) {
				this._isInSharedCalendar = calendarInfoForEvent.shared
				this.readOnly = calendarInfoForEvent.shared &&
					(!hasCapabilityOnGroup(this._user, calendarInfoForEvent.group, ShareCapability.Write) ||
						this.attendees.length > 0)
			} else {
				// We can edit new invites (from files)
				this.readOnly = false
			}
		}

		this.possibleOrganizers = existingOrganizer && !this.canModifyOrganizer()
			? [existingOrganizer]
			: this._mailAddresses

		if (existingEvent) {
			this.summary(existingEvent.summary)
			const calendarForGroup = calendars.get(neverNull(existingEvent._ownerGroup))
			if (calendarForGroup) {
				this.selectedCalendar(calendarForGroup)
			}
			this.allDay(isAllDayEvent(existingEvent))
			this.startDate = getStartOfDayWithZone(getEventStart(existingEvent, this._zone), this._zone)
			if (this.allDay()) {
				this.startTime = timeStringInZone(getEventStart(existingEvent, this._zone), this.amPmFormat, this._zone)
				this.endTime = timeStringInZone(getEventEnd(existingEvent, this._zone), this.amPmFormat, this._zone)
				this.endDate = incrementDate(getEventEnd(existingEvent, this._zone), -1)
			} else {
				this.endDate = getStartOfDayWithZone(getEventEnd(existingEvent, this._zone), this._zone)
			}
			this.startTime = timeStringInZone(getEventStart(existingEvent, this._zone), this.amPmFormat, this._zone)
			this.endTime = timeStringInZone(getEventEnd(existingEvent, this._zone), this.amPmFormat, this._zone)
			if (existingEvent.repeatRule) {
				const existingRule = existingEvent.repeatRule
				const repeat = {
					frequency: downcast(existingRule.frequency),
					interval: Number(existingRule.interval),
					endType: downcast(existingRule.endType),
					endValue: existingRule.endType === EndType.Count ? Number(existingRule.endValue) : 1,
				}
				if (existingRule.endType === EndType.UntilDate) {
					const rawEndDate = new Date(Number(existingRule.endValue))
					const localDate = this.allDay() ? getAllDayDateForTimezone(rawEndDate, this._zone) : rawEndDate
					// Shown date is one day behind the actual end (for us it's excluded)
					const shownDate = incrementByRepeatPeriod(localDate, RepeatPeriod.DAILY, -1, this._zone)
					repeat.endValue = shownDate.getTime()
				}
				this.repeat = repeat
			} else {
				this.repeat = null
			}
			this.location(existingEvent.location)
			this.note = existingEvent.description

			for (let alarmInfoId of existingEvent.alarmInfos) {
				if (isSameId(listIdPart(alarmInfoId), neverNull(this._user.alarmInfoList).alarms)) {
					load(UserAlarmInfoTypeRef, alarmInfoId).then((userAlarmInfo) => {
						this.addAlarm(downcast(userAlarmInfo.alarmInfo.trigger))
					})
				}
			}
		} else {
			const endTimeDate = new Date(date)
			endTimeDate.setMinutes(endTimeDate.getMinutes() + 30)
			this.startTime = timeString(date, this.amPmFormat)
			this.endTime = timeString(endTimeDate, this.amPmFormat)
			this.startDate = getStartOfDayWithZone(date, this._zone)
			this.endDate = getStartOfDayWithZone(date, this._zone)
			m.redraw()
		}
	}

	_findOwnAttendee() {
		return this.attendees.find(a => this._mailAddresses.includes(a.address.address))
	}

	onStartTimeSelected(value: string) {
		this.startTime = value
		if (this.startDate.getTime() === this.endDate.getTime()) {
			this._adjustEndTime()
		}
	}

	onEndTimeSelected(value: string) {
		this.endTime = value
	}

	addAttendee(mailAddress: string) {
		if (this.attendees.find((a) => a.address.address === mailAddress)) {
			return
		}
		const attendee = createCalendarEventAttendee({
			status: CalendarAttendeeStatus.NEEDS_ACTION,
			address: createEncryptedMailAddress({address: mailAddress}),
		})
		this.attendees.push(attendee)
	}

	_adjustEndTime() {
		const parsedOldStartTime = this._oldStartTime && parseTime(this._oldStartTime)
		const parsedStartTime = parseTime(this.startTime)
		const parsedEndTime = parseTime(this.endTime)
		if (!parsedStartTime || !parsedEndTime || !parsedOldStartTime) {
			return
		}
		const endTotalMinutes = parsedEndTime.hours * 60 + parsedEndTime.minutes
		const startTotalMinutes = parsedStartTime.hours * 60 + parsedStartTime.minutes
		const diff = Math.abs(endTotalMinutes - parsedOldStartTime.hours * 60 - parsedOldStartTime.minutes)
		const newEndTotalMinutes = startTotalMinutes + diff
		let newEndHours = Math.floor(newEndTotalMinutes / 60)
		if (newEndHours > 23) {
			newEndHours = 23
		}
		const newEndMinutes = newEndTotalMinutes % 60
		this.endTime = timeStringFromParts(newEndHours, newEndMinutes, this.amPmFormat)
		this._oldStartTime = this.startTime
	}

	onStartDateSelected(date: ?Date) {
		if (date) {
			// The custom ID for events is derived from the unix timestamp, and sorting the negative ids is a challenge we decided not to
			// tackle because it is a rare case.
			if (date && date.getFullYear() < TIMESTAMP_ZERO_YEAR) {
				const thisYear = (new Date()).getFullYear()
				let newDate = new Date(date)
				newDate.setFullYear(thisYear)
				this.startDate = newDate
			} else {
				const diff = getDiffInDays(date, this.startDate)
				this.endDate = DateTime.fromJSDate(this.endDate, {zone: this._zone}).plus({days: diff}).toJSDate()
				this.startDate = date
			}
		}
	}

	onEndDateSelected(date: ?Date) {
		if (date) {
			this.endDate = date
		}
	}

	onRepeatPeriodSelected(repeatPeriod: ?RepeatPeriodEnum) {
		if (repeatPeriod == null) {
			this.repeat = null
		} else {
			// Provide default values if repeat is not there, override them with existing repeat if it's there, provide new frequency
			// First empty object is for Flow.
			this.repeat = Object.assign({}, {interval: 1, endType: EndType.Never, endValue: 1}, this.repeat, {frequency: repeatPeriod})
		}
	}

	onEndOccurencesSelected(endValue: number) {
		if (this.repeat && this.repeat.endType === EndType.Count) {
			this.repeat.endValue = endValue
		}
	}

	onRepeatEndDateSelected(endDate: ?Date) {
		const {repeat} = this
		if (endDate && repeat && repeat.endType === EndType.UntilDate) {
			repeat.endValue = endDate.getTime()
		}
	}

	onRepeatIntervalChanged(interval: number) {
		if (this.repeat) {
			this.repeat.interval = interval
		}
	}

	onRepeatEndTypeChanged(endType: EndTypeEnum) {
		const {repeat} = this
		if (repeat) {
			repeat.endType = endType
			if (endType === EndType.UntilDate) {
				repeat.endValue = incrementByRepeatPeriod(new Date(), RepeatPeriod.MONTHLY, 1, this._zone).getTime()
			} else {
				repeat.endValue = 1
			}
		}
	}

	addAlarm(trigger: AlarmIntervalEnum) {
		const alarm = createCalendarAlarm(generateEventElementId(Date.now()), trigger)
		this.alarms = this.alarms.concat(alarm)
	}

	changeAlarm(identifier: string, trigger: ?AlarmIntervalEnum) {
		const newAlarms = this.alarms.slice()
		for (let i = 0; i < newAlarms.length; i++) {
			if (newAlarms[i].alarmIdentifier === identifier) {
				if (trigger) {
					newAlarms[i].trigger = trigger
				} else {
					newAlarms.splice(i, 1)
				}
				this.alarms = newAlarms
				break
			}
		}
	}

	changeDescription(description: string) {
		this.note = description
	}

	canModifyGuests(): boolean {
		return !this._isInSharedCalendar && (!this.existingEvent || !this.existingEvent.isCopy)
	}

	removeAttendee(address: string) {
		findAndRemove(this.attendees, (a) => a.address.address === address)
	}

	canModifyOwnAttendance(): boolean {
		return !this._isInSharedCalendar && (this._viewingOwnEvent() || !!this._findOwnAttendee())
	}

	canModifyOrganizer(): boolean {
		return !this._isInSharedCalendar && (!this.existingEvent || !this.existingEvent.isCopy) && this.attendees.length === 0
	}

	_viewingOwnEvent(): boolean {
		return (
			!this.existingEvent
			|| (
				!this.existingEvent.isCopy
				&& (
					this.existingEvent.organizer == null ||
					this.possibleOrganizers.includes(this.existingEvent.organizer)
				)
			)
		)
	}

	/**
	 * @return Promise<bool> whether to close dialog
	 */
	deleteEvent(): Promise<bool> {
		const event = this.existingEvent
		// TODO: check if it works
		if (event) {
			const awaitCancellation = this._viewingOwnEvent() && !this._isInSharedCalendar && event.attendees.length
				? this._distributor.sendCancellation(event, event.attendees.map(a => a.address))
				: Promise.resolve()
			return awaitCancellation.then(() => this._calendarModel.deleteEvent(event)).catch(NotFoundError, noOp)
		} else {
			return Promise.resolve(true)
		}
	}

	onOkPressed(): Promise<EventCreateResult> {
		// We have to use existing instance to get all the final fields correctly
		// Using clone feels hacky but otherwise we need to save all attributes of the existing event somewhere and if dialog is
		// cancelled we also don't want to modify passed event
		const newEvent = this.existingEvent ? clone(this.existingEvent) : createCalendarEvent()

		let startDate = new Date(this.startDate)
		let endDate = new Date(this.endDate)

		if (this.allDay()) {
			startDate = getAllDayDateUTCFromZone(startDate, this._zone)
			endDate = getAllDayDateUTCFromZone(getStartOfNextDayWithZone(endDate, this._zone), this._zone)
		} else {
			const parsedStartTime = parseTime(this.startTime)
			const parsedEndTime = parseTime(this.endTime)
			if (!parsedStartTime || !parsedEndTime) {
				return Promise.resolve({status: "error", error: "timeFormatInvalid_msg"})
			}
			startDate = DateTime.fromJSDate(startDate, {zone: this._zone})
			                    .set({hour: parsedStartTime.hours, minute: parsedStartTime.minutes})
			                    .toJSDate()

			// End date is never actually included in the event. For the whole day event the next day
			// is the boundary. For the timed one the end time is the boundary.
			endDate = DateTime.fromJSDate(endDate, {zone: this._zone})
			                  .set({hour: parsedEndTime.hours, minute: parsedEndTime.minutes})
			                  .toJSDate()
		}

		if (endDate.getTime() <= startDate.getTime()) {
			return Promise.resolve({status: "error", error: "startAfterEnd_label"})
		}
		newEvent.startTime = startDate
		newEvent.description = this.note
		newEvent.summary = this.summary()
		newEvent.location = this.location()
		newEvent.endTime = endDate
		const groupRoot = this.selectedCalendar().groupRoot
		newEvent._ownerGroup = this.selectedCalendar().groupRoot._id
		newEvent.uid = this.existingEvent && this.existingEvent.uid ? this.existingEvent.uid : generateUid(newEvent, Date.now())
		const repeat = this.repeat
		if (repeat == null) {
			newEvent.repeatRule = null
		} else {
			const interval = repeat.interval || 1
			const repeatRule = createRepeatRuleWithValues(repeat.frequency, interval)
			newEvent.repeatRule = repeatRule

			const stopType = repeat.endType
			repeatRule.endType = stopType
			if (stopType === EndType.Count) {
				const count = repeat.endValue
				if (isNaN(count) || Number(count) < 1) {
					repeatRule.endType = EndType.Never
				} else {
					repeatRule.endValue = String(count)
				}
			} else if (stopType === EndType.UntilDate) {
				const repeatEndDate = getStartOfNextDayWithZone(new Date(repeat.endValue), this._zone)
				if (repeatEndDate.getTime() < getEventStart(newEvent, this._zone)) {
					// Dialog.error("startAfterEnd_label")
					return Promise.resolve({status: "error", error: "startAfterEnd_label"})
				} else {
					// We have to save repeatEndDate in the same way we save start/end times because if one is timzone
					// dependent and one is not then we have interesting bugs in edge cases (event created in -11 could
					// end on another date in +12). So for all day events end date is UTC-encoded all day event and for
					// regular events it is just a timestamp.
					repeatRule.endValue =
						String((this.allDay() ? getAllDayDateUTCFromZone(repeatEndDate, this._zone) : repeatEndDate).getTime())
				}
			}
		}
		const newAlarms = this.alarms.slice()
		newEvent.attendees = this.attendees
		if (this.existingEvent) {
			newEvent.sequence = String(filterInt(this.existingEvent.sequence) + 1)
		}

		// We need to compute diff of attendees to know if we need to send out updates
		let newAttendees: Array<CalendarEventAttendee> = []
		let existingAttendees: Array<CalendarEventAttendee> = []
		let removedAttendees: Array<CalendarEventAttendee>
		const {existingEvent} = this

		newEvent.organizer = this.organizer

		if (this._viewingOwnEvent()) {
			if (existingEvent) {
				this.attendees.forEach((a) => {
					if (this._mailAddresses.includes(a.address.address)) {
						return
					}
					if (existingEvent.attendees.find(ea => ea.address.address === a.address.address)) {
						existingAttendees.push(a)
					} else {
						newAttendees.push(a)
					}
				})
				removedAttendees = existingEvent.attendees.filter((ea) =>
					!this._mailAddresses.includes(ea.address.address)
					&& !this.attendees.find((a) => ea.address.address === a.address.address)
				)
			} else {
				newAttendees = this.attendees.filter(a => !this._mailAddresses.includes(a.address.address))
				removedAttendees = []
			}
		} else {
			removedAttendees = []
			if (existingEvent) {
				// We are not using this._findAttendee() because we want to search it on the event, before our modifications
				const ownAttendee = existingEvent.attendees.find(a => this._mailAddresses.includes(a.address.address))
				if (ownAttendee && this.going !== CalendarAttendeeStatus.NEEDS_ACTION && ownAttendee.status !== this.going) {
					ownAttendee.status = this.going
					this._distributor.sendResponse(newEvent, createMailAddress({
						name: ownAttendee.address.name,
						address: ownAttendee.address.address,
					}), this.going)
				}
			}
		}

		const doCreateEvent = () => {
			if (existingEvent == null
				|| existingEvent._ownerGroup !== newEvent._ownerGroup // event has been moved to another calendar
				|| newEvent.startTime.getTime() !== existingEvent.startTime.getTime()
				|| !repeatRulesEqual(newEvent.repeatRule, existingEvent.repeatRule)
			) {
				// if values of the existing events have changed that influence the alarm time then delete the old event and create a new
				// one.
				assignEventId(newEvent, this._zone, groupRoot)
				// Reset ownerEncSessionKey because it cannot be set for new entity, it will be assigned by the CryptoFacade
				newEvent._ownerEncSessionKey = null
				// Reset permissions because server will assign them
				downcast(newEvent)._permissions = null

				// We don't want to pass event from ics file to the facade because it's just a template event and there's nothing to clean
				// up.
				const oldEventToPass = existingEvent && existingEvent._ownerGroup ? existingEvent : null
				return this._calendarModel.createEvent(newEvent, newAlarms, oldEventToPass)
			} else {
				return this._calendarModel.updateEvent(newEvent, newAlarms, existingEvent)
			}
		}

		if (this._viewingOwnEvent() && existingAttendees.length || removedAttendees.length) {
			// ask for update
			return Promise.resolve({
				status: "ok",
				askForUpdates: (sendOutUpdate) => {
					return doCreateEvent()
						.then(() => sendOutUpdate && existingAttendees.length
							? this._distributor.sendUpdate(newEvent, this._distributionAddresses(existingAttendees))
							: Promise.resolve())
						.then(() => sendOutUpdate && newAttendees.length
							? this._distributor.sendInvite(newEvent, this._distributionAddresses(newAttendees))
							: Promise.resolve())
						.then(() => {
							sendOutUpdate && removedAttendees.length
								? this._distributor.sendCancellation(newEvent, this._distributionAddresses(removedAttendees))
								: Promise.resolve()
						})
				}
			})
		} else {
			// just create the event
			return doCreateEvent().then(() => {
				if (newAttendees.length) {
					return this._distributor.sendInvite(newEvent, this._distributionAddresses(newAttendees))
				}
			}).then(() => {
				return {
					status: "ok",
					askForUpdates: null
				}
			})
		}
	}

	selectGoing(going: CalendarAttendeeStatusEnum) {
		if (this.canModifyOwnAttendance()) {
			this.going = going
			const ownAttendee = this._findOwnAttendee()
			if (ownAttendee) {
				ownAttendee.status = going
			} else {
				this.attendees.unshift(createCalendarEventAttendee({
					address: createEncryptedMailAddress({
						address: firstThrow(this._mailAddresses)
					}),
					status: going,
				}))
			}
		}
	}

	_distributionAddresses(guests: Array<CalendarEventAttendee>): Array<EncryptedMailAddress> {
		return guests.map((a) => a.address)
	}
}

function createCalendarAlarm(identifier: string, trigger: string): AlarmInfo {
	const calendarAlarmInfo = createAlarmInfo()
	calendarAlarmInfo.alarmIdentifier = identifier
	calendarAlarmInfo.trigger = trigger
	return calendarAlarmInfo
}

// allDay event consists of full UTC days. It always starts at 00:00:00.00 of its start day in UTC and ends at
// 0 of the next day in UTC. Full day event time is relative to the local timezone. So startTime and endTime of
// allDay event just points us to the correct date.
// e.g. there's an allDay event in Europe/Berlin at 2nd of may. We encode it as:
// {startTime: new Date(Date.UTC(2019, 04, 2, 0, 0, 0, 0)), {endTime: new Date(Date.UTC(2019, 04, 3, 0, 0, 0, 0))}}
// We check the condition with time == 0 and take a UTC date (which is [2-3) so full day on the 2nd of May). We
function repeatRulesEqual(repeatRule: ?CalendarRepeatRule, repeatRule2: ?CalendarRepeatRule): boolean {
	return (repeatRule == null && repeatRule2 == null) ||
		(repeatRule != null && repeatRule2 != null &&
			repeatRule.endType === repeatRule2.endType &&
			repeatRule.endValue === repeatRule2.endValue &&
			repeatRule.frequency === repeatRule2.frequency &&
			repeatRule.interval === repeatRule2.interval &&
			repeatRule.timeZone === repeatRule2.timeZone)
}
