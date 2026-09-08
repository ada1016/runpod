from appdaemon.plugins.hass import Hass

import requests
from bs4 import BeautifulSoup


# ============================================================
# Shin Shin Gas URLs
# ============================================================

BASE_URL = "https://www.shinshingas.com.tw/Customer_Service/"

LOGIN_URL = (
    "https://www.shinshingas.com.tw/"
    "Customer_Service/gas_degree/consumer_diyUserNo"
)

SUBMIT_URL = (
    "https://www.shinshingas.com.tw/"
    "Customer_Service/gas_degree/consumer_diy_result"
)


# ============================================================
# AppDaemon application
# ============================================================

class GasMeter(Hass):

    def initialize(self):

        # ----------------------------------------------------
        # Home Assistant entities
        # ----------------------------------------------------

        self.reading_entity = (
            "input_text.gas_meter_reading"
        )

        self.submit_button = (
            "input_button.submit_gas_meter"
        )

        self.status_entity = (
            "sensor.gas_meter_submission_status"
        )

        self.last_reading_entity = (
            "sensor.gas_meter_last_reading"
        )

        self.last_submission_entity = (
            "sensor.gas_meter_last_submission"
        )

        # ----------------------------------------------------
        # Credentials from apps.yaml -> secrets.yaml
        # ----------------------------------------------------

        self.user_id = str(
            self.args["user_id"]
        ).strip()

        self.phone_zone = str(
            self.args["phone_zone"]
        ).strip()

        self.phone_number = str(
            self.args["phone_number"]
        ).strip()

        # ----------------------------------------------------
        # Prevent simultaneous / double submissions
        # ----------------------------------------------------

        self.busy = False

        # ----------------------------------------------------
        # Listen for Submit Gas Meter button
        # ----------------------------------------------------

        self.listen_state(
            self.submit_pressed,
            self.submit_button
        )

        # ----------------------------------------------------
        # Initial HA status
        # ----------------------------------------------------

        self.set_status(
            "ready",
            message="Ready"
        )

        self.log(
            "========================================"
        )

        self.log(
            "Gas Meter backend READY"
        )

        self.log(
            "No website request is made at startup"
        )

        self.log(
            f"Reading entity: {self.reading_entity}"
        )

        self.log(
            f"Submit button: {self.submit_button}"
        )

        self.log(
            "Credentials loaded from secrets.yaml"
        )

        self.log(
            "========================================"
        )


    # ========================================================
    # Home Assistant button callback
    # ========================================================

    def submit_pressed(
        self,
        entity,
        attribute,
        old,
        new,
        kwargs
    ):

        # ----------------------------------------------------
        # Prevent double-click / parallel submission
        # ----------------------------------------------------

        if self.busy:

            self.log(
                "Submission ignored: "
                "another submission is already running",
                level="WARNING"
            )

            return

        reading = self.get_state(
            self.reading_entity
        )

        self.log(
            f"Submit button pressed. "
            f"Raw reading = {reading}"
        )

        try:

            reading = self.validate_reading(
                reading
            )

        except ValueError as err:

            self.log(
                f"Invalid reading: {err}",
                level="ERROR"
            )

            self.set_status(
                "invalid",
                message=str(err)
            )

            return

        # ----------------------------------------------------
        # Real submission starts here
        # ----------------------------------------------------

        self.busy = True

        try:

            self.set_status(
                "submitting",
                message="Submitting gas meter reading",
                reading=reading
            )

            result = self.submit_to_gas_company(
                reading
            )

            # ------------------------------------------------
            # SUCCESS
            # ------------------------------------------------

            if result["success"]:

                now = self.datetime().isoformat()

                self.set_state(
                    self.last_reading_entity,
                    state=reading,
                    attributes={
                        "friendly_name":
                            "Gas Meter Last Reading"
                    }
                )

                self.set_state(
                    self.last_submission_entity,
                    state=now,
                    attributes={
                        "friendly_name":
                            "Gas Meter Last Submission"
                    }
                )

                self.set_status(
                    "success",
                    message="Gas reading accepted",
                    reading=reading,
                    confirmation=result[
                        "confirmation"
                    ],
                    history_found=result[
                        "history_found"
                    ],
                    history_contains_reading=result[
                        "history_contains_reading"
                    ],
                    company_date=result[
                        "company_date"
                    ],
                    company_reading=result[
                        "company_reading"
                    ]
                )

                self.log(
                    "========================================"
                )

                self.log(
                    f"SUCCESS: gas meter reading "
                    f"{reading} submitted"
                )

                self.log(
                    "Gas-company confirmation detected: "
                    f"{result['confirmation']}"
                )

                self.log(
                    "History table detected: "
                    f"{result['history_found']}"
                )

                self.log(
                    "Reading found in history table: "
                    f"{result['history_contains_reading']}"
                )

                self.log(
                    "Company history date: "
                    f"{result['company_date']}"
                )

                self.log(
                    "Company history reading: "
                    f"{result['company_reading']}"
                )

                self.log(
                    "========================================"
                )

            # ------------------------------------------------
            # WEBSITE RETURNED PAGE BUT NO CONFIRMATION
            # ------------------------------------------------

            else:

                self.set_status(
                    "failed",
                    message=(
                        "Gas company response did not "
                        "confirm the reading"
                    ),
                    reading=reading,
                    confirmation=result[
                        "confirmation"
                    ],
                    history_found=result[
                        "history_found"
                    ],
                    history_contains_reading=result[
                        "history_contains_reading"
                    ],
                    company_date=result[
                        "company_date"
                    ],
                    company_reading=result[
                        "company_reading"
                    ]
                )

                self.log(
                    "Gas company did not confirm "
                    f"reading {reading}",
                    level="ERROR"
                )

        # ----------------------------------------------------
        # NETWORK / PARSING / LOGIN ERROR
        # ----------------------------------------------------

        except Exception as err:

            self.log(
                f"Gas meter submission ERROR: {err}",
                level="ERROR"
            )

            self.set_status(
                "error",
                message=str(err),
                reading=reading
            )

        finally:

            self.busy = False


    # ========================================================
    # Home Assistant status helper
    # ========================================================

    def set_status(
        self,
        state,
        message=None,
        reading=None,
        **extra
    ):

        attributes = {
            "friendly_name":
                "Gas Meter Submission Status"
        }

        if message is not None:

            attributes[
                "message"
            ] = message

        if reading is not None:

            attributes[
                "reading"
            ] = reading

        for key, value in extra.items():

            attributes[
                key
            ] = value

        self.set_state(
            self.status_entity,
            state=state,
            attributes=attributes
        )


    # ========================================================
    # UI progress helper
    #
    # Keeps Home Assistant/AppDaemon as the source of truth.
    # Tab5 only receives the current concise progress message.
    # ========================================================

    def set_progress(
        self,
        message,
        reading=None
    ):

        self.set_status(
            "submitting",
            message=message,
            reading=reading
        )


    # ========================================================
    # Validate meter reading
    # ========================================================

    def validate_reading(
        self,
        reading
    ):

        if reading is None:

            raise ValueError(
                "No gas meter reading supplied"
            )

        reading = str(
            reading
        ).strip()

        if not reading:

            raise ValueError(
                "Gas meter reading is empty"
            )

        if not reading.isdigit():

            raise ValueError(
                "Gas meter reading must contain "
                "digits only"
            )

        if len(reading) > 4:

            raise ValueError(
                "Gas meter reading cannot exceed "
                "four digits"
            )

        # Same behavior as Google Apps Script:
        #
        # ("0000" + meterReading).slice(-4)

        return reading.zfill(4)


    # ========================================================
    # Parse HTTP response using BeautifulSoup's encoding
    # detection.
    #
    # This is more reliable for this Taiwanese site than
    # requests.apparent_encoding alone.
    # ========================================================

    def parse_response(
        self,
        response
    ):

        soup = BeautifulSoup(
            response.content,
            "html.parser"
        )

        encoding = (
            soup.original_encoding
            or response.encoding
            or "utf-8"
        )

        try:

            html = response.content.decode(
                encoding,
                errors="replace"
            )

        except Exception:

            html = response.content.decode(
                "utf-8",
                errors="replace"
            )

            encoding = "utf-8"

        return (
            soup,
            html,
            encoding
        )


    # ========================================================
    # ASP.NET hidden fields
    # ========================================================

    def extract_hidden_fields(
        self,
        soup
    ):

        result = {}

        keys = [
            "__VIEWSTATE",
            "__EVENTVALIDATION",
            "__VIEWSTATEGENERATOR"
        ]

        for key in keys:

            field = soup.find(
                "input",
                {
                    "name": key
                }
            )

            if field is None:

                field = soup.find(
                    "input",
                    {
                        "id": key
                    }
                )

            if field is not None:

                result[key] = field.get(
                    "value",
                    ""
                )

        return result


    # ========================================================
    # Find the four meter-entry fields
    # ========================================================

    def find_meter_fields(
        self,
        soup
    ):

        names = [
            "ctl00$ContentPlaceHolder1$no1",
            "ctl00$ContentPlaceHolder1$no2",
            "ctl00$ContentPlaceHolder1$no3",
            "ctl00$ContentPlaceHolder1$no4"
        ]

        found = []

        for name in names:

            field = soup.find(
                attrs={
                    "name": name
                }
            )

            if field is not None:

                found.append(
                    name
                )

        return found


    # ========================================================
    # Extract the matching returned history row
    #
    # Expected table shape from Shin Shin Gas:
    #     自報日期 | 度數
    #
    # We do not assume exact column indexes beyond locating
    # the submitted reading in one row.
    # ========================================================

    def extract_history_confirmation(
        self,
        history_table,
        reading
    ):

        result = {
            "company_date": "",
            "company_reading": ""
        }

        if history_table is None:
            return result

        wanted = str(reading).strip()

        for row in history_table.find_all("tr"):

            cells = [
                cell.get_text(" ", strip=True)
                for cell in row.find_all(["td", "th"])
            ]

            if not cells:
                continue

            normalized = [
                str(cell).strip()
                for cell in cells
            ]

            reading_index = None

            for index, value in enumerate(normalized):
                if value == wanted:
                    reading_index = index
                    break

            if reading_index is None:
                continue

            result["company_reading"] = wanted

            # In the observed return page the date is the column
            # immediately before the reading. Fall back to another
            # non-empty value from the same row if necessary.
            if reading_index > 0:
                result["company_date"] = normalized[reading_index - 1]
            else:
                for value in normalized:
                    if value and value != wanted:
                        result["company_date"] = value
                        break

            return result

        return result


    # ========================================================
    # Main Shin Shin Gas transaction
    # ========================================================

    def submit_to_gas_company(
        self,
        reading
    ):

        session = requests.Session()

        session.headers.update({
            "User-Agent":
                "Mozilla/5.0 "
                "(Home Assistant Gas Meter)",

            "Accept":
                "text/html,application/xhtml+xml,"
                "application/xml;q=0.9,*/*;q=0.8"
        })

        # ====================================================
        # STEP 1
        # GET initial login page
        # ====================================================

        self.log(
            "STEP 1: loading login page"
        )

        self.set_progress(
            "Loading Shin Shin Gas login page",
            reading
        )

        response = session.get(
            LOGIN_URL,
            timeout=20
        )

        response.raise_for_status()

        (
            login_soup,
            login_html,
            login_encoding
        ) = self.parse_response(
            response
        )

        self.log(
            f"STEP 1 HTTP status: "
            f"{response.status_code}"
        )

        hidden_fields = (
            self.extract_hidden_fields(
                login_soup
            )
        )

        if "__VIEWSTATE" not in hidden_fields:

            raise RuntimeError(
                "Login page missing __VIEWSTATE"
            )

        # ====================================================
        # STEP 2
        # POST account + telephone
        # ====================================================

        self.log(
            "STEP 2: logging into "
            "Shin Shin Gas"
        )

        self.set_progress(
            "Logging into Shin Shin Gas",
            reading
        )

        login_payload = {
            **hidden_fields,

            "ctl00$ContentPlaceHolder1$AccountNO":
                self.user_id,

            "ctl00$ContentPlaceHolder1$txtZone":
                self.phone_zone,

            "ctl00$ContentPlaceHolder1$txtTel":
                self.phone_number,

            "ctl00$ContentPlaceHolder1$Button1":
                "確認送出"
        }

        login_response = session.post(
            LOGIN_URL,
            data=login_payload,
            allow_redirects=True,
            timeout=20
        )

        login_response.raise_for_status()

        (
            meter_soup,
            meter_html,
            meter_encoding
        ) = self.parse_response(
            login_response
        )

        self.log(
            f"STEP 2 HTTP status: "
            f"{login_response.status_code}"
        )

        self.log(
            f"STEP 2 final URL: "
            f"{login_response.url}"
        )

        # ====================================================
        # STEP 3
        # Verify meter-entry page
        # ====================================================

        meter_fields = (
            self.find_meter_fields(
                meter_soup
            )
        )

        if len(meter_fields) != 4:

            raise RuntimeError(
                "Login failed: "
                "four meter-entry fields "
                "were not found"
            )

        self.log(
            "STEP 3: login verified, "
            "4/4 meter fields found"
        )

        self.set_progress(
            "Login verified - meter page ready",
            reading
        )

        # ====================================================
        # STEP 4
        # Extract second ASP.NET state
        # ====================================================

        submit_hidden = (
            self.extract_hidden_fields(
                meter_soup
            )
        )

        if "__VIEWSTATE" not in submit_hidden:

            raise RuntimeError(
                "Meter page missing __VIEWSTATE"
            )

        hid_data = meter_soup.find(
            "input",
            {
                "id":
                    "ContentPlaceHolder1_hidData"
            }
        )

        if hid_data is not None:

            hid_data_value = (
                hid_data.get(
                    "value",
                    "1"
                )
            )

        else:

            # Matches behavior of original
            # Google Apps Script.
            hid_data_value = "1"

        # ====================================================
        # STEP 5
        # Build actual meter submission
        # ====================================================

        digits = list(
            reading
        )

        submit_payload = {
            **submit_hidden,

            "ctl00$ContentPlaceHolder1$no1":
                digits[0],

            "ctl00$ContentPlaceHolder1$no2":
                digits[1],

            "ctl00$ContentPlaceHolder1$no3":
                digits[2],

            "ctl00$ContentPlaceHolder1$no4":
                digits[3],

            "ctl00$ContentPlaceHolder1$hidData":
                hid_data_value,

            "ctl00$ContentPlaceHolder1$LinkButton1":
                "確認送出"
        }

        # ====================================================
        # STEP 6
        # REAL SUBMISSION
        # ====================================================

        self.log(
            f"STEP 4: submitting "
            f"gas reading {reading}"
        )

        self.set_progress(
            f"Submitting gas reading {reading}",
            reading
        )

        final_response = session.post(
            SUBMIT_URL,
            data=submit_payload,
            allow_redirects=True,
            timeout=20
        )

        final_response.raise_for_status()

        (
            final_soup,
            final_html,
            final_encoding
        ) = self.parse_response(
            final_response
        )

        self.log(
            f"STEP 4 HTTP status: "
            f"{final_response.status_code}"
        )

        self.log(
            f"STEP 4 final URL: "
            f"{final_response.url}"
        )

        # ====================================================
        # STEP 7
        # Verify result
        # ====================================================

        self.set_progress(
            "Submission returned - verifying result",
            reading
        )

        page_text = final_soup.get_text(
            " ",
            strip=True
        )

        # Specific success phrase used by
        # the existing Apps Script.
        confirmation = (
            "自報度數成功"
            in page_text
        )

        # ====================================================
        # STEP 8
        # Check history table
        # ====================================================

        history_table = final_soup.find(
            "table",
            {
                "id":
                    "ContentPlaceHolder1_DataGrid1"
            }
        )

        history_found = (
            history_table is not None
        )

        history_contains_reading = False

        company_date = ""
        company_reading = ""

        if history_table is not None:

            history_text = (
                history_table.get_text(
                    " ",
                    strip=True
                )
            )

            history_contains_reading = (
                reading in history_text
            )

            history_confirmation = (
                self.extract_history_confirmation(
                    history_table,
                    reading
                )
            )

            company_date = history_confirmation[
                "company_date"
            ]

            company_reading = history_confirmation[
                "company_reading"
            ]

        # ====================================================
        # Final decision
        #
        # Primary evidence:
        #     自報度數成功
        #
        # Secondary evidence:
        #     returned history table contains reading
        # ====================================================

        success = (
            confirmation
            or (
                history_found
                and history_contains_reading
            )
        )

        self.log(
            "STEP 5: verification complete"
        )

        self.log(
            f"Specific confirmation found: "
            f"{confirmation}"
        )

        self.log(
            f"History table found: "
            f"{history_found}"
        )

        self.log(
            f"Submitted reading in history: "
            f"{history_contains_reading}"
        )

        return {
            "success":
                success,

            "confirmation":
                confirmation,

            "history_found":
                history_found,

            "history_contains_reading":
                history_contains_reading,

            "company_date":
                company_date,

            "company_reading":
                company_reading
        }
